import { createContext, ReactNode, useContext, useState, useEffect, useRef } from 'react';
import { useLocation, useHistory } from 'react-router-dom';
import { c } from 'ttag';
import {
    useApi,
    useGetUserKeys,
    useMessageCounts,
    useNotifications,
    useOnLogout,
    useSubscribeEventManager,
    useUser,
} from '@proton/components';
import { wait } from '@proton/shared/lib/helpers/promise';
import { EVENT_ACTIONS, SECOND } from '@proton/shared/lib/constants';
import { EVENT_ERRORS } from '@proton/shared/lib/errors';
import { hasBit } from '@proton/shared/lib/helpers/bitset';
import { useGetMessageKeys } from '../hooks/message/useGetMessageKeys';
import { Event } from '../models/event';
import { Element } from '../models/element';
import {
    EncryptedSearch,
    EncryptedSearchFunctions,
    ESDBStatus,
    ESStatus,
    IncrementSearch,
    HighlightMetadata,
    HighlightString,
    LastEmail,
    ESMessage,
    IsSearchResult,
    ESCache,
} from '../models/encryptedSearch';
import { defaultESCache, defaultESStatus, PAGE_SIZE } from '../constants';
import { extractSearchParameters, filterFromUrl, pageFromUrl, setSortInUrl, sortFromUrl } from '../helpers/mailboxUrl';
import { isSearch as testIsSearch } from '../helpers/elements';
import {
    indexKeyExists,
    isPaused,
    isRecoveryNeeded,
    getNumMessagesDB,
    isESEnabled,
    wasIndexingDone,
    getTotalFromBuildProgress,
    setCurrentToBuildProgress,
    canUseES,
    deleteESDB,
    removeESFlags,
    removeES,
    setES,
    getES,
    esSentryReport,
} from '../helpers/encryptedSearch/esUtils';
import { buildDB, getIndexKey, initialiseDB } from '../helpers/encryptedSearch/esBuild';
import {
    hybridSearch,
    normaliseSearchParams,
    shouldOnlySortResults,
    uncachedSearch,
} from '../helpers/encryptedSearch/esSearch';
import { cacheDB, refreshESCache } from '../helpers/encryptedSearch/esCache';
import {
    checkIsDBLimited,
    correctDecryptionErrors,
    refreshIndex,
    syncMessageEvents,
} from '../helpers/encryptedSearch/esSync';
import { queryEvents, sendESMetrics } from '../helpers/encryptedSearch/esAPI';
import { highlightJSX, insertMarks } from '../helpers/encryptedSearch/esHighlight';

const EncryptedSearchContext = createContext<EncryptedSearchFunctions>(null as any);
export const useEncryptedSearchContext = () => useContext(EncryptedSearchContext);

interface Props {
    children?: ReactNode;
}

const EncryptedSearchProvider = ({ children }: Props) => {
    const location = useLocation();
    const history = useHistory();
    const getUserKeys = useGetUserKeys();
    const getMessageKeys = useGetMessageKeys();
    const api = useApi();
    const [{ ID: userID }] = useUser();
    const { createNotification } = useNotifications();
    const [messageCounts] = useMessageCounts();
    const isSearch = testIsSearch(extractSearchParameters(location));

    // Keep a state of search results to update in case of new events
    // and information on the status of IndexedDB
    const [esStatus, setESStatus] = useState<ESStatus>(defaultESStatus);
    // Keep a reference to cached messages, such that they can be queried at any time
    const esCacheRef = useRef<ESCache>(defaultESCache);
    // Allow to abort indexing
    const abortIndexingRef = useRef<AbortController>(new AbortController());
    // Allow to abort searching
    const abortSearchingRef = useRef<AbortController>(new AbortController());
    // Allow to track progress during indexing or refreshing
    const progressRecorderRef = useRef<[number, number]>([0, 0]);
    // Allow to track progress during syncing
    const syncingEventsRef = useRef<Promise<void>>(Promise.resolve());
    // Allow to track changes in page to set the elements list accordingly
    const pageRef = useRef<number>(0);

    /**
     * Chain several synchronisations to account for events being fired when
     * previous ones are still being processed
     */
    const addSyncing = async (callback: () => Promise<void>) => {
        syncingEventsRef.current = syncingEventsRef.current.then(() => callback());
    };

    /**
     * Delete localStorage blobs and IDB
     */
    const esDelete = async () => {
        abortIndexingRef.current.abort();
        abortSearchingRef.current.abort();
        removeESFlags(userID);
        setESStatus(() => defaultESStatus);
        return deleteESDB(userID);
    };

    /**
     * Abort ongoing operations if the user logs out
     */
    useOnLogout(async () => {
        abortIndexingRef.current.abort();
        abortSearchingRef.current.abort();
    });

    /**
     * Notify the user the DB is deleted. Typically this is needed if the key is no
     * longer usable to decrypt it
     */
    const dbCorruptError = async () => {
        await esDelete();
        createNotification({
            text: c('Error').t`Please activate your content search again`,
            type: 'error',
        });
    };

    /**
     * Store progress of operations
     */
    const recordProgress = (progress: number, total: number) => {
        progressRecorderRef.current = [progress, total];
    };

    /**
     * Give access to progress made during operations
     */
    const getProgressRecorderRef = () => {
        return progressRecorderRef;
    };

    /**
     * Report the status of IndexedDB
     */
    const getESDBStatus = () => {
        const { dbExists, isBuilding, isDBLimited, esEnabled, isRefreshing, isSearchPartial, isSearching, isCaching } =
            esStatus;
        const { isCacheLimited } = esCacheRef.current;
        const esDBStatus: ESDBStatus = {
            dbExists,
            isBuilding,
            isDBLimited,
            esEnabled,
            isCacheLimited,
            isRefreshing,
            isSearchPartial,
            isSearching,
            isCaching,
        };
        return esDBStatus;
    };

    /**
     * Once encrypted search is active, allow to switch back to server-side metadata search
     */
    const toggleEncryptedSearch = () => {
        const currentOption = esStatus.esEnabled;

        setESStatus((esStatus) => {
            return {
                ...esStatus,
                esEnabled: !currentOption,
            };
        });

        if (currentOption) {
            abortSearchingRef.current.abort();
            removeES.Enabled(userID);
        } else {
            // Every time ES is enabled, we reset sorting to avoid carrying on with SIZE sorting in
            // case it was previously used. SIZE sorting is not supported by ES
            if (testIsSearch(extractSearchParameters(location))) {
                history.push(setSortInUrl(history.location, { sort: 'Time', desc: true }));
            }
            setES.Enabled(userID);
        }

        // If IDB was evicted by the browser in the meantime, we erase everything else too
        void canUseES(userID).then((isIDBIntact) => {
            if (!isIDBIntact) {
                void dbCorruptError();
            }
        });
    };

    /**
     * Cache IndexedDB
     */
    const cacheIndexedDB = async () => {
        const { esEnabled, dbExists, cachedIndexKey, isCaching } = esStatus;

        if (dbExists && esEnabled) {
            const indexKey = cachedIndexKey || (await getIndexKey(getUserKeys, userID));
            const isIDBIntact = await canUseES(userID);
            if (!indexKey || !isIDBIntact) {
                await dbCorruptError();
                return;
            }

            const { isCacheReady } = esCacheRef.current;
            if (isCaching || isCacheReady) {
                return;
            }

            setESStatus((esStatus) => {
                return {
                    ...esStatus,
                    isCaching: true,
                    cachedIndexKey: indexKey,
                };
            });

            await cacheDB(indexKey, userID, esCacheRef);

            esCacheRef.current.isCacheReady = true;
            setESStatus((esStatus) => {
                return {
                    ...esStatus,
                    isCaching: false,
                };
            });
        }
    };

    /**
     * Keep IndexedDB in sync with new events
     */
    const syncIndexedDB = async (event: Event, indexKey: CryptoKey, recordProgressLocal?: () => void) => {
        const { Messages, Addresses } = event;
        const isUpdatingMessageContent = typeof recordProgressLocal !== 'undefined';

        // In case a key is reactivated, try to fix any decryption error that might
        // have happened during indexing
        const attemptReDecryption =
            Addresses && Addresses.some((AddressEvent) => AddressEvent.Action === EVENT_ACTIONS.UPDATE);
        if (attemptReDecryption) {
            recordProgress(0, 0);

            // In case we weren't already showing the refreshing UI, we do now
            if (!isUpdatingMessageContent) {
                setESStatus((esStatus) => {
                    return {
                        ...esStatus,
                        isRefreshing: true,
                    };
                });
            }

            await correctDecryptionErrors(userID, indexKey, api, getMessageKeys, recordProgress, esCacheRef);

            if (!isUpdatingMessageContent) {
                setESStatus((esStatus) => {
                    return {
                        ...esStatus,
                        isRefreshing: false,
                    };
                });
            }
        }

        if (!Messages || !Messages.length) {
            return;
        }

        // Resetting is necessery to show appropriate UI when syncing immediately after refreshing
        if (attemptReDecryption) {
            recordProgress(0, 0);
        }

        const { labelID, permanentResults, setElementsCache } = esStatus;

        const searchParameters = extractSearchParameters(location);
        const filterParameter = filterFromUrl(location);
        const sortParameter = sortFromUrl(location);
        const isSearch = testIsSearch(searchParameters);
        const normalisedSearchParams = normaliseSearchParams(searchParameters, labelID, filterParameter, sortParameter);

        const searchChanged = await syncMessageEvents(
            Messages,
            userID,
            esCacheRef,
            permanentResults,
            isSearch,
            api,
            getMessageKeys,
            indexKey,
            normalisedSearchParams,
            recordProgressLocal
        );

        if (searchChanged) {
            setElementsCache(permanentResults, pageRef.current);
            setESStatus((esStatus) => {
                return {
                    ...esStatus,
                    permanentResults,
                };
            });
        }
    };

    /**
     * Check whether a refresh is needed
     */
    const checkResfresh = async (
        indexKey: CryptoKey,
        eventToCheck: Event,
        wasAlreadyRefreshing: boolean
    ): Promise<Event | undefined> => {
        // Resetting is necessery to show appropriate UI when refreshing immediately after indexing
        recordProgress(0, 0);

        if (hasBit(eventToCheck.Refresh, EVENT_ERRORS.MAIL)) {
            // In case we weren't already showing the refreshing UI, we do now
            if (!wasAlreadyRefreshing) {
                setESStatus((esStatus) => {
                    return {
                        ...esStatus,
                        isRefreshing: true,
                    };
                });
            }

            // Refresh needs to happen and will account for all events, potentially
            // except those that happened since beginning it
            const newEventToCheck = await refreshIndex(
                userID,
                api,
                indexKey,
                getMessageKeys,
                recordProgress,
                messageCounts
            );

            if (!wasAlreadyRefreshing) {
                setESStatus((esStatus) => {
                    return {
                        ...esStatus,
                        isRefreshing: false,
                    };
                });
            }

            return newEventToCheck;
        }
    };

    /**
     * Conclude any type of syncing routine
     */
    const finaliseSyncing = async (event: Event, indexKey: CryptoKey) => {
        // In case everything goes through, save the last event ID from which to
        // catch up the next time
        if (event.EventID) {
            setES.Event(userID, event.EventID);
        }

        // In case many messages were removed from cache, fill the remaining space
        await refreshESCache(userID, indexKey, esCacheRef);

        // Check if DB became limited after the update
        const isDBLimited = await checkIsDBLimited(userID, messageCounts, api);
        setESStatus((esStatus) => {
            return {
                ...esStatus,
                isRefreshing: false,
                isDBLimited,
            };
        });
    };

    /**
     * Catch up with all changes contained in the given event
     */
    const catchUpFromEvent = async (indexKey: CryptoKey, currentEvent: Event): Promise<void> => {
        let refreshEvent: Event | undefined;
        try {
            refreshEvent = await checkResfresh(indexKey, currentEvent, false);
        } catch (error) {
            esSentryReport('catchUpFromEvent: checkResfresh', { error });
            setESStatus((esStatus) => {
                return {
                    ...esStatus,
                    isRefreshing: false,
                };
            });
            return catchUpFromEvent(indexKey, currentEvent);
        }

        const eventToCheck = refreshEvent || currentEvent;

        try {
            await syncIndexedDB(eventToCheck, indexKey);
        } catch (error) {
            esSentryReport('catchUpFromEvent: syncIndexedDB', { error });
            setESStatus((esStatus) => {
                return {
                    ...esStatus,
                    isRefreshing: false,
                };
            });
            // In case syncing fails, we retry but from the event after refreshing, otherwise
            // a new refresh will be triggered
            return catchUpFromEvent(indexKey, eventToCheck);
        }

        return finaliseSyncing(eventToCheck, indexKey);
    };

    /**
     * Fetch all events since a previously stored one
     */
    const catchUpFromLS = async (indexKey: CryptoKey): Promise<void> => {
        const isIDBIntact = await canUseES(userID);
        const storedEventID = getES.Event(userID);
        if (!isIDBIntact || !storedEventID) {
            await dbCorruptError();
            return;
        }

        setESStatus((esStatus) => {
            return {
                ...esStatus,
                isRefreshing: true,
            };
        });

        // Resetting is necessery to show appropriate UI when refreshing immediately after indexing
        recordProgress(0, 0);

        // If there is no event to check, syncing is considered failed and will be retried
        const currentEvent = await queryEvents(api, storedEventID);
        if (!currentEvent || !currentEvent.EventID) {
            setESStatus((esStatus) => {
                return {
                    ...esStatus,
                    isRefreshing: false,
                };
            });
            return catchUpFromLS(indexKey);
        }

        let refreshEvent: Event | undefined;
        try {
            refreshEvent = await checkResfresh(indexKey, currentEvent, true);

            // We store the event to check after refresh has happened, such that if anything fails
            // later, the process will continue from after the refresh. Otherwise, a new
            // refresh would be triggered
            if (refreshEvent) {
                if (refreshEvent.EventID) {
                    setES.Event(userID, refreshEvent.EventID);
                } else {
                    throw new Error('Refresh event has no ID');
                }
            }
        } catch (error) {
            esSentryReport('catchUpFromLS: checkResfresh', { error });
            setESStatus((esStatus) => {
                return {
                    ...esStatus,
                    isRefreshing: false,
                };
            });
            return catchUpFromLS(indexKey);
        }

        // Resetting is necessery to show appropriate UI when syncing immediately after refreshing
        recordProgress(0, 0);

        // We want to sync all messages, potentially in multiple batches if the More flag
        // is set. Even it isn't, we still fetch a further batch and, if the event ID hasn't
        // changed, we can be sure nothing else has happened and the syncing process is considered
        // successful
        let keepSyncing = true;
        let index = 0;
        const newEventsToCheck: Event[] = [refreshEvent || currentEvent];
        while (keepSyncing) {
            try {
                const nextEventToCheck = newEventsToCheck[index++];

                const newEventToCheck = await queryEvents(api, nextEventToCheck.EventID);
                if (!newEventToCheck || !newEventToCheck.EventID) {
                    throw new Error('No event found');
                }

                keepSyncing = nextEventToCheck.More === 1 || newEventToCheck.EventID !== nextEventToCheck.EventID;
                if (keepSyncing) {
                    newEventsToCheck.push(newEventToCheck);
                }
            } catch (error) {
                esSentryReport('catchUpFromLS: queryEvents', { error });
                setESStatus((esStatus) => {
                    return {
                        ...esStatus,
                        isRefreshing: false,
                    };
                });
                return catchUpFromLS(indexKey);
            }
        }

        // Since we are only interested in Message and Address events, they are the only ones used to
        // compute the total
        const Total = newEventsToCheck.reduce((accumulator, event) => {
            const addressEvents = (event.Addresses || []).filter(
                (AddressEvent) => AddressEvent.Action === EVENT_ACTIONS.UPDATE
            ).length;
            return accumulator + (event.Messages?.length || 0) + addressEvents;
        }, 0);
        const recordProgressLocal = () => {
            const [current] = progressRecorderRef.current;
            recordProgress(current + 1, Total);
        };

        try {
            // It's important that these events are synced sequentially
            for (const eventToCheck of newEventsToCheck) {
                await syncIndexedDB(eventToCheck, indexKey, recordProgressLocal);
            }
        } catch (error) {
            esSentryReport('catchUpFromLS: syncIndexedDB', { error });
            setESStatus((esStatus) => {
                return {
                    ...esStatus,
                    isRefreshing: false,
                };
            });
            return catchUpFromLS(indexKey);
        }

        return finaliseSyncing(newEventsToCheck[newEventsToCheck.length - 1], indexKey);
    };

    /**
     * Pause a running indexig
     */
    const pauseIndexing = async () => {
        abortIndexingRef.current.abort();
        setESStatus((esStatus) => {
            return {
                ...esStatus,
                isBuilding: false,
            };
        });
        setES.Pause(userID);
        const isIDBIntact = await canUseES(userID);
        if (!isIDBIntact) {
            await dbCorruptError();
        }
    };

    /**
     * Resume an existing indexing operation or start one anew
     */
    const resumeIndexing = async () => {
        const isResumed = isPaused(userID);

        setESStatus((esStatus) => {
            return {
                ...esStatus,
                esEnabled: true,
            };
        });
        setES.Enabled(userID);

        const showError = (notSupported?: boolean) => {
            createNotification({
                text: notSupported
                    ? c('Error')
                          .t`Content search cannot be enabled in this browser. Please quit private browsing mode or use another browser`
                    : c('Error').t`A problem occurred, please try again`,
                type: 'error',
            });
            setESStatus(() => defaultESStatus);
        };

        removeES.Pause(userID);
        abortIndexingRef.current = new AbortController();

        let indexKey: CryptoKey;
        if (!indexKeyExists(userID) && !isResumed) {
            const { notSupported, indexKey: newIndexKey } = await initialiseDB(userID, getUserKeys, api);
            if (!newIndexKey) {
                showError(notSupported);
                return;
            }
            indexKey = newIndexKey;
        } else {
            const existingIndexKey = await getIndexKey(getUserKeys, userID);
            if (!existingIndexKey) {
                await dbCorruptError();
                return;
            }
            indexKey = existingIndexKey;
        }

        const totalMessages = getTotalFromBuildProgress(userID);
        const mailboxEmpty = totalMessages === 0;
        recordProgress(await getNumMessagesDB(userID), totalMessages);

        setESStatus((esStatus) => {
            return {
                ...esStatus,
                isBuilding: true,
            };
        });

        let success = mailboxEmpty;
        while (!success) {
            const currentMessages = await getNumMessagesDB(userID);
            recordProgress(currentMessages, totalMessages);
            const recordProgressLocal = (progress: number) => {
                const newProgress = currentMessages + progress;
                setCurrentToBuildProgress(userID, newProgress);
                recordProgress(newProgress, totalMessages);
            };

            success = await buildDB(userID, indexKey, getMessageKeys, api, abortIndexingRef, recordProgressLocal);

            // Kill switch in case user logs out or pauses
            if (abortIndexingRef.current.signal.aborted || isPaused(userID)) {
                return;
            }

            const isIDBIntact = await canUseES(userID);
            if (!isIDBIntact) {
                await dbCorruptError();
                return;
            }

            await wait(2 * SECOND);
        }

        // Finalise IndexedDB building by catching up with new messages
        setESStatus((esStatus) => {
            return {
                ...esStatus,
                isBuilding: false,
            };
        });

        // Catch up with events since the last one before indexing, which was set in
        // the Event blob in localStorage during initialisation. Note that we finalise
        // indexing even it this step fails, because it will be retried at every new
        // event and refresh
        const catchUpPromise = catchUpFromLS(indexKey);
        addSyncing(() => catchUpPromise);
        await catchUpPromise;

        // Note that it's safe to remove the BuildProgress blob because the event to catch
        // up from is stored in the Event blob
        removeES.Progress(userID);

        setESStatus((esStatus) => {
            return {
                ...esStatus,
                dbExists: true,
            };
        });

        createNotification({
            text: c('Success').t`Message content search activated`,
        });
    };

    /**
     * Execute an encrypted search
     */
    const encryptedSearch: EncryptedSearch = async (labelID, setCache) => {
        const t1 = performance.now();
        const {
            dbExists,
            esEnabled,
            previousNormSearchParams,
            permanentResults,
            isSearchPartial: wasSearchPartial,
            cachedIndexKey,
            isCaching,
        } = esStatus;

        if (!dbExists || !esEnabled) {
            return false;
        }

        const isIDBIntact = await canUseES(userID);
        if (!isIDBIntact) {
            await dbCorruptError();
            return false;
        }

        // Prevent old searches from interfering with newer ones
        abortSearchingRef.current.abort();

        // Caching needs to be triggered here for when a refresh happens on a search URL
        if (!isCaching && !esCacheRef.current.isCacheReady) {
            void cacheIndexedDB();
        }

        const searchParameters = extractSearchParameters(location);
        const filterParameter = filterFromUrl(location);
        const sortParameter = sortFromUrl(location);
        const normalisedSearchParams = normaliseSearchParams(searchParameters, labelID, filterParameter, sortParameter);

        // In case only sorting changed, for complete searches it doesn't make sense to perform a new search
        if (!wasSearchPartial && previousNormSearchParams) {
            const shouldSortOnly = shouldOnlySortResults(normalisedSearchParams, previousNormSearchParams);
            if (shouldSortOnly) {
                setCache(permanentResults, pageRef.current);
                return true;
            }
        }

        setESStatus((esStatus) => {
            return {
                ...esStatus,
                isSearching: true,
                isSearchPartial: true,
            };
        });

        // Record the number of messages that were actually searched (i.e. not discarded by means of filters)
        let numMessagesSearched = 0;
        const incrementMessagesSearched = () => {
            numMessagesSearched++;
        };

        abortSearchingRef.current = new AbortController();
        const controlledSetCache = (Elements: Element[]) => {
            if (!abortSearchingRef.current.signal.aborted) {
                setCache(Elements, pageRef.current);
            }
        };

        let searchResults: ESMessage[] = [];
        let isSearchPartial = false;
        let lastEmail: LastEmail | undefined;
        try {
            ({ searchResults, isSearchPartial, lastEmail } = await hybridSearch(
                esCacheRef,
                normalisedSearchParams,
                cachedIndexKey,
                getUserKeys,
                userID,
                incrementMessagesSearched,
                controlledSetCache,
                abortSearchingRef
            ));
        } catch (error: any) {
            esSentryReport('encryptedSearch: hybridSearch', { error });
            // If the key is the problem, then we want to wipe the DB and fall back to
            // server-side search, otherwise we want to show a generic error and still
            // fall back to server-side search
            if (error.message === 'Key not found') {
                await dbCorruptError();
                return false;
            }
            throw error;
        }

        if (!abortSearchingRef.current.signal.aborted) {
            setESStatus((esStatus) => {
                return {
                    ...esStatus,
                    permanentResults: searchResults,
                    labelID,
                    setElementsCache: setCache,
                    lastEmail,
                    previousNormSearchParams: normalisedSearchParams,
                    page: 0,
                    isSearchPartial,
                    isSearching: false,
                };
            });
            setCache(searchResults, pageRef.current);

            const t2 = performance.now();
            void sendESMetrics(
                api,
                userID,
                esCacheRef.current.cacheSize,
                numMessagesSearched,
                Math.ceil(t2 - t1),
                searchResults.length,
                !esCacheRef.current.isCacheReady,
                esCacheRef.current.isCacheLimited
            );
        }

        return true;
    };

    /**
     * Increase the number of results in case the cache is limited as the user changes page
     */
    const incrementSearch: IncrementSearch = async (page, setElementsCache, shouldLoadMore) => {
        const { isCacheLimited } = esCacheRef.current;
        const {
            dbExists,
            esEnabled,
            labelID,
            permanentResults,
            lastEmail,
            isSearchPartial,
            cachedIndexKey,
            isSearching,
        } = esStatus;
        if (!dbExists || !esEnabled || !isCacheLimited || abortSearchingRef.current.signal.aborted || isSearching) {
            return;
        }

        const lastFilledPage = Math.ceil(permanentResults.length / PAGE_SIZE) - 1;
        if (page <= pageRef.current || page < lastFilledPage - 1) {
            return;
        }

        const searchParameters = extractSearchParameters(location);
        const filterParameter = filterFromUrl(location);
        const sortParameter = sortFromUrl(location);
        const isSearch = testIsSearch(searchParameters);
        if (!isSearch || !isSearchPartial) {
            return;
        }

        const neededResults = PAGE_SIZE * (lastFilledPage + 2);
        let messageLimit = 0;
        if (permanentResults.length < neededResults) {
            messageLimit = neededResults - permanentResults.length;
        } else {
            return;
        }
        // If the user wants to load more, then one page is added such that
        // the page+1 wrt the one the user is visualising is already cached
        if (shouldLoadMore) {
            messageLimit += PAGE_SIZE;
        }

        setESStatus((esStatus) => {
            return {
                ...esStatus,
                isSearching: true,
            };
        });

        const normalisedSearchParams = normaliseSearchParams(searchParameters, labelID, filterParameter, sortParameter);
        const indexKey = cachedIndexKey || (await getIndexKey(getUserKeys, userID));
        if (!indexKey) {
            await dbCorruptError();
            return;
        }

        const searchOutput = await uncachedSearch(userID, indexKey, normalisedSearchParams, {
            messageLimit,
            beginOrder: lastEmail?.Order,
            lastEmailTime: lastEmail?.Time,
            abortSearchingRef,
        });

        if (!abortSearchingRef.current.signal.aborted) {
            permanentResults.push(...searchOutput.resultsArray);
            const newIsSearchPartial = !!searchOutput.lastEmail;

            setESStatus((esStatus) => {
                return {
                    ...esStatus,
                    permanentResults,
                    lastEmail: searchOutput.lastEmail,
                    isSearchPartial: newIsSearchPartial,
                    isSearching: false,
                };
            });
            setElementsCache(permanentResults, page);
        }
    };

    /**
     * Check whether to highlight keywords upon opening a result of any search (both server-side and encrypted)
     */
    const shouldHighlight = () => {
        const searchParameters = extractSearchParameters(location);
        const isSearch = testIsSearch(searchParameters);
        if (!isSearch) {
            return false;
        }

        const { labelID } = esStatus;
        const { normalisedKeywords } = normaliseSearchParams(searchParameters, labelID);
        if (!normalisedKeywords) {
            return false;
        }

        return true;
    };

    /**
     * Highlight keywords in body. Return a string with the new body
     */
    const highlightString: HighlightString = (content, setAutoScroll) => {
        const searchParameters = extractSearchParameters(location);
        const { labelID } = esStatus;
        const { normalisedKeywords } = normaliseSearchParams(searchParameters, labelID);
        if (!normalisedKeywords) {
            return content;
        }

        return insertMarks(content, normalisedKeywords, setAutoScroll);
    };

    /**
     * Highlight keywords in metadata. Return the JSX element to be rendered
     */
    const highlightMetadata: HighlightMetadata = (metadata, isBold, trim) => {
        const searchParameters = extractSearchParameters(location);
        const { labelID } = esStatus;
        const { normalisedKeywords } = normaliseSearchParams(searchParameters, labelID);
        if (!normalisedKeywords) {
            return {
                numOccurrences: 0,
                resultJSX: <span>{metadata}</span>,
            };
        }

        return highlightJSX(metadata, normalisedKeywords, isBold, trim);
    };

    /**
     * Check whether a message is part of the current search results
     */
    const isSearchResult: IsSearchResult = (ID) => {
        const { dbExists, esEnabled, permanentResults } = esStatus;
        if (!(dbExists && esEnabled && isSearch)) {
            return false;
        }

        return permanentResults.findIndex((result) => result.ID === ID) !== -1;
    };

    useSubscribeEventManager(async (event: Event) => {
        const { dbExists, cachedIndexKey } = esStatus;
        if (!dbExists) {
            return;
        }

        const indexKey = cachedIndexKey || (await getIndexKey(getUserKeys, userID));
        const isIDBIntact = await canUseES(userID);
        if (!indexKey || !isIDBIntact) {
            await dbCorruptError();
            return;
        }

        // Every time a new event happens, we simply catch up everything since the last
        // processed event. In case any failure occurs, the event ID stored will not be
        // overwritten
        addSyncing(() => catchUpFromEvent(indexKey, event));
    });

    useEffect(() => {
        pageRef.current = pageFromUrl(location);
    }, [pageFromUrl(location)]);

    // Remove previous search data from the status when no longer in search mode
    useEffect(() => {
        if (!isSearch) {
            abortSearchingRef.current.abort();
            setESStatus((esStatus) => {
                return {
                    ...esStatus,
                    permanentResults: defaultESStatus.permanentResults,
                    setElementsCache: defaultESStatus.setElementsCache,
                    labelID: defaultESStatus.labelID,
                    lastEmail: defaultESStatus.lastEmail,
                    previousNormSearchParams: defaultESStatus.previousNormSearchParams,
                    isSearchPartial: defaultESStatus.isSearchPartial,
                    isSearching: defaultESStatus.isSearching,
                };
            });
        }
    }, [isSearch]);

    useEffect(() => {
        if (!indexKeyExists(userID)) {
            return;
        }

        const run = async () => {
            const indexKey = await getIndexKey(getUserKeys, userID);
            const isIDBIntact = await canUseES(userID);
            if (!indexKey || !isIDBIntact) {
                await dbCorruptError();
                return;
            }

            setESStatus((esStatus) => {
                return {
                    ...esStatus,
                    dbExists: wasIndexingDone(userID),
                    esEnabled: isESEnabled(userID),
                };
            });

            // If indexing was not successful, try to recover (unless it was paused).
            // Otherwise, just set the correct parameters to ESDBStatus
            if (isRecoveryNeeded(userID)) {
                if (!isPaused(userID)) {
                    await resumeIndexing();
                }
                return;
            }

            // Compare the last event "seen" by the DB (saved in localStorage) and
            // the present one to check whether any event has happened while offline,
            // but only if indexing was successful
            addSyncing(() => catchUpFromLS(indexKey));
        };

        void run();
    }, []);

    const esFunctions = {
        encryptedSearch,
        cacheIndexedDB,
        getESDBStatus,
        toggleEncryptedSearch,
        resumeIndexing,
        pauseIndexing,
        getProgressRecorderRef,
        incrementSearch,
        highlightString,
        highlightMetadata,
        shouldHighlight,
        isSearchResult,
    };

    return <EncryptedSearchContext.Provider value={esFunctions}>{children}</EncryptedSearchContext.Provider>;
};

export default EncryptedSearchProvider;
