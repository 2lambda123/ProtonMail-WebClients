import { useState, useEffect, FormEvent, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import { c, msgid } from 'ttag';
import { getUnixTime, fromUnixTime, isBefore, isAfter, add } from 'date-fns';
import {
    classnames,
    generateUID,
    usePopperAnchor,
    DropdownButton,
    TopNavbarListItemSearchButton,
    Dropdown,
    Icon,
    DateInput,
    Radio,
    Button,
    PrimaryButton,
    Label,
    Select,
    useLabels,
    useFolders,
    useMailSettings,
    useToggle,
    useUser,
    useModals,
    ConfirmModal,
    Toggle,
    Info,
    Progress,
    useFeature,
    FeatureCode,
    Tooltip,
    LinkButton,
} from '@proton/components';
import { MAILBOX_LABEL_IDS, SECOND, SHOW_MOVED } from '@proton/shared/lib/constants';
import { validateEmailAddress } from '@proton/shared/lib/helpers/email';
import { hasBit } from '@proton/shared/lib/helpers/bitset';
import { buildTreeview, formatFolderName } from '@proton/shared/lib/helpers/folder';
import { FolderWithSubFolders } from '@proton/shared/lib/interfaces/Folder';
import { changeSearchParams, getSearchParams } from '@proton/shared/lib/helpers/url';
import { Recipient } from '@proton/shared/lib/interfaces/Address';
import { wait } from '@proton/shared/lib/helpers/promise';
import { isMobile } from '@proton/shared/lib/helpers/browser';
import { isPaid } from '@proton/shared/lib/user/helpers';
import isTruthy from '@proton/shared/lib/helpers/isTruthy';

import { getHumanLabelID } from '../../helpers/labels';
import AddressesInput from '../composer/addresses/AddressesInput';
import { extractSearchParameters, keywordToString } from '../../helpers/mailboxUrl';
import { formatSimpleDate } from '../../helpers/date';
import {
    indexKeyExists,
    getOldestTime,
    wasIndexingDone,
    isDBReadyAfterBuilding,
    isPaused,
    getProgressFromBuildProgress,
    getTotalFromBuildProgress,
} from '../../helpers/encryptedSearch/esUtils';
import { useEncryptedSearchContext } from '../../containers/EncryptedSearchProvider';
import { ESIndexingState } from '../../models/encryptedSearch';
import { defaultESIndexingState } from '../../constants';
import { estimateIndexingTime } from '../../helpers/encryptedSearch/esBuild';

import './AdvancedSearchDropdown.scss';
import { useClickMailContent } from '../../hooks/useClickMailContent';
import SearchField from './SearchField';

interface SearchModel {
    keyword: string;
    labelID: string;
    from: Recipient[];
    to: Recipient[];
    begin?: Date;
    end?: Date;
    attachments?: number;
    wildcard?: number;
    filter?: string;
}

interface LabelInfo {
    text: string;
    value: string;
    group: string;
}

const UNDEFINED = undefined;
const AUTO_WILDCARD = undefined;
const NO_ATTACHMENTS = 0;
const WITH_ATTACHMENTS = 1;
const { INBOX, TRASH, SPAM, STARRED, ARCHIVE, ALL_MAIL, ALL_SENT, SENT, ALL_DRAFTS, DRAFTS, SCHEDULED } =
    MAILBOX_LABEL_IDS;
const DEFAULT_MODEL: SearchModel = {
    keyword: '',
    labelID: ALL_MAIL,
    from: [],
    to: [],
    attachments: UNDEFINED,
    wildcard: AUTO_WILDCARD,
    filter: UNDEFINED,
};

const getRecipients = (value = '') =>
    value
        .split(',')
        .filter(validateEmailAddress)
        .map((Address) => ({ Address, Name: '' }));
const formatRecipients = (recipients: Recipient[] = []) => recipients.map(({ Address }) => Address).join(',');

const folderReducer = (acc: LabelInfo[], folder: FolderWithSubFolders, level = 0) => {
    acc.push({
        text: formatFolderName(level, folder.Name, ' ∙ '),
        value: folder.ID,
        group: c('Group').t`Custom folders`,
    });

    if (Array.isArray(folder.subfolders)) {
        folder.subfolders.forEach((folder) => folderReducer(acc, folder, level + 1));
    }

    return acc;
};

interface Props {
    keyword?: string;
    isNarrow: boolean;
}

const AdvancedSearchDropdown = ({ keyword: fullInput = '', isNarrow }: Props) => {
    const history = useHistory();
    const [uid] = useState(generateUID('advanced-search-dropdown'));
    const [mailSettings, loadingMailSettings] = useMailSettings();
    const { anchorRef, isOpen, toggle, close } = usePopperAnchor<HTMLButtonElement>();
    useClickMailContent((event) => {
        if (anchorRef.current?.contains(event.target as Node)) {
            // Click on the anchor will already close the dropdown, doing it twice will reopen it
            return;
        }
        close();
    });
    const [labels = [], loadingLabels] = useLabels();
    const [folders, loadingFolders] = useFolders();
    const [model, updateModel] = useState<SearchModel>(DEFAULT_MODEL);
    const { state: showMore, toggle: toggleShowMore } = useToggle(false);
    const [user] = useUser();
    const { createModal } = useModals();
    const {
        resumeIndexing,
        getESDBStatus,
        pauseIndexing,
        toggleEncryptedSearch,
        getProgressRecorderRef,
        cacheIndexedDB,
    } = useEncryptedSearchContext();
    const { isBuilding, esEnabled, isDBLimited, isRefreshing } = getESDBStatus();
    const [esState, setESState] = useState<ESIndexingState>(defaultESIndexingState);
    const { esProgress, oldestTime, totalIndexingMessages, estimatedMinutes, currentProgressValue } = esState;
    const abortProgressRef = useRef<AbortController>(new AbortController());
    const { loading: loadingESFeature, feature: esFeature } = useFeature(FeatureCode.EnabledEncryptedSearch);
    const { feature: scheduledFeature, loading: loadingScheduledFeature } = useFeature(FeatureCode.ScheduledSend);

    // Get right keyword value depending on the current situation
    const getKeyword = (keyword: string, reset?: boolean) => {
        if (reset) {
            return UNDEFINED;
        }
        const value = isNarrow ? keyword : keywordToString(keyword);
        if (value) {
            return value;
        }
        return UNDEFINED;
    };

    const handleSubmit = (event: FormEvent, reset?: boolean) => {
        event.preventDefault(); // necessary to not run a basic submission
        event.stopPropagation(); // necessary to not submit normal search from header

        const { keyword, begin, end, wildcard, from, to, attachments, filter } = reset ? DEFAULT_MODEL : model;

        history.push(
            changeSearchParams(`/${getHumanLabelID(model.labelID)}`, history.location.hash, {
                keyword: getKeyword(keyword, reset),
                from: from.length ? formatRecipients(from) : UNDEFINED,
                to: to.length ? formatRecipients(to) : UNDEFINED,
                begin: begin ? String(getUnixTime(begin)) : UNDEFINED,
                end: end ? String(getUnixTime(end)) : UNDEFINED,
                attachments: typeof attachments === 'number' ? String(attachments) : UNDEFINED,
                wildcard: wildcard ? String(wildcard) : UNDEFINED,
                filter,
                sort: UNDEFINED, // Make sure to reset sort parameter when performing an advanced search
                page: UNDEFINED, // Reset page parameter when performing an advanced search so that search results are shown from the first page
            })
        );

        close();
    };

    const handleReset = (event: FormEvent) => handleSubmit(event, true);

    const confirmationToIndex = () => {
        createModal(
            <ConfirmModal
                onConfirm={resumeIndexing}
                title={c('Title').t`Enable message content search`}
                confirm={c('Action').t`Enable`}
                mode="alert"
            >
                {c('Info')
                    .t`This action will download all messages so they can be searched locally. Clearing your browser data will disable this option.`}
            </ConfirmModal>
        );
    };

    const setProgress = async () => {
        while (!abortProgressRef.current.signal.aborted) {
            setESState((esState) => {
                const [esProgress, esTotal] = getProgressRecorderRef().current;
                const endTime = performance.now();

                const { estimatedMinutes, currentProgressValue } = estimateIndexingTime(
                    esProgress,
                    esTotal,
                    endTime,
                    esState
                );

                return {
                    ...esState,
                    endTime,
                    esProgress,
                    totalIndexingMessages: esTotal,
                    estimatedMinutes: estimatedMinutes || esState.estimatedMinutes,
                    currentProgressValue: currentProgressValue || esState.currentProgressValue,
                };
            });
            await wait(2 * SECOND);
        }
    };

    const setOldestTime = async () => {
        if (wasIndexingDone(user.ID) && isDBLimited) {
            const oldestTime = await getOldestTime(user.ID, 1000);
            setESState((esState) => {
                return {
                    ...esState,
                    oldestTime,
                };
            });
        }
    };

    const startProgress = async () => {
        abortProgressRef.current = new AbortController();
        const [esPrevProgress, totalIndexingMessages] = getProgressRecorderRef().current;
        setESState((esState) => {
            return {
                ...esState,
                startTime: performance.now(),
                esPrevProgress,
                totalIndexingMessages,
            };
        });
        void setProgress();
    };

    const stopProgress = () => {
        abortProgressRef.current.abort();
        setESState(() => defaultESIndexingState);
    };

    useEffect(() => {
        if (isOpen) {
            updateModel(() => {
                const { keyword, address, attachments, wildcard, from, to, begin, end } = extractSearchParameters(
                    history.location
                );

                const { filter } = getSearchParams(history.location.search);

                return {
                    ...DEFAULT_MODEL, // labelID re-initialized to ALL_MAIL
                    keyword: keyword || fullInput || '',
                    address,
                    attachments,
                    wildcard,
                    from: getRecipients(from),
                    to: getRecipients(to),
                    begin: begin ? fromUnixTime(begin) : UNDEFINED,
                    end: end ? fromUnixTime(end) : UNDEFINED,
                    filter,
                };
            });
            void setOldestTime();
        }
    }, [isOpen]);

    useEffect(() => {
        if (isBuilding || isRefreshing) {
            void startProgress();
        } else {
            stopProgress();
        }
        void setOldestTime();
    }, [isBuilding, isRefreshing]);

    const loading =
        loadingLabels || loadingFolders || loadingMailSettings || loadingESFeature || loadingScheduledFeature;

    const treeview: FolderWithSubFolders[] = buildTreeview(folders);

    const labelIDOptions: LabelInfo[] = (
        [
            { value: ALL_MAIL, text: c('Mailbox').t`All`, group: c('Group').t`Default folders` },
            { value: INBOX, text: c('Mailbox').t`Inbox`, group: c('Group').t`Default folders` },
            {
                value: hasBit(mailSettings?.ShowMoved || 0, SHOW_MOVED.DRAFTS) ? ALL_DRAFTS : DRAFTS,
                text: c('Mailbox').t`Drafts`,
                group: c('Group').t`Default folders`,
            },
            scheduledFeature?.Value && {
                value: SCHEDULED,
                text: c('Mailbox').t`Scheduled`,
                group: c('Group').t`Default folders`,
            },
            {
                value: hasBit(mailSettings?.ShowMoved || 0, SHOW_MOVED.SENT) ? ALL_SENT : SENT,
                text: c('Mailbox').t`Sent`,
                group: c('Group').t`Default folders`,
            },
            { value: STARRED, text: c('Mailbox').t`Starred`, group: c('Group').t`Default folders` },
            { value: ARCHIVE, text: c('Mailbox').t`Archive`, group: c('Group').t`Default folders` },
            { value: SPAM, text: c('Mailbox').t`Spam`, group: c('Group').t`Default folders` },
            { value: TRASH, text: c('Mailbox').t`Trash`, group: c('Group').t`Default folders` },
        ] as LabelInfo[]
    )
        .filter(isTruthy)
        .concat(treeview.reduce<LabelInfo[]>((acc, folder) => folderReducer(acc, folder), []))
        .concat(labels.map(({ ID: value, Name: text }) => ({ value, text, group: c('Group').t`Labels` })));

    // Switches
    const showEncryptedSearch = !isMobile() && !!esFeature && !!esFeature.Value && !!isPaid(user);
    const showAdvancedSearch = !showEncryptedSearch || showMore;
    const showProgress = indexKeyExists(user.ID) && esEnabled && (!isDBReadyAfterBuilding(user.ID) || isRefreshing);
    const showSubTitleSection = wasIndexingDone(user.ID) && !isRefreshing && isDBLimited;
    const isEstimating =
        estimatedMinutes === 0 && (totalIndexingMessages === 0 || esProgress !== totalIndexingMessages);

    // ES progress
    const progressFromBuildEvent = isRefreshing ? 0 : getProgressFromBuildProgress(user.ID);
    const progressValue = isEstimating ? progressFromBuildEvent : currentProgressValue;

    // Header
    const esTitle = <span className="mr0-5">{c('Action').t`Search message content`}</span>;
    // Remove one day from limit because the last day in IndexedDB might not be complete
    const oldestDate = formatSimpleDate(add(new Date(oldestTime), { days: 1 }));
    const subTitleSection = (
        // translator: the variable is a date, which is already localised
        <span className="color-weak mr0-5">{c('Info').jt`For messages newer than ${oldestDate}`}</span>
    );
    const esToggleTooltip =
        wasIndexingDone(user.ID) && !isBuilding
            ? c('Info').t`Turn off content search. Activation progress won't be lost.`
            : c('Info').t`Activation in progress`;
    const esCTA = indexKeyExists(user.ID) ? (
        <Tooltip title={esToggleTooltip}>
            <span>
                <Toggle
                    id="es-toggle"
                    className="mlauto flex-item-noshrink"
                    checked={wasIndexingDone(user.ID) && esEnabled && !isBuilding}
                    onChange={toggleEncryptedSearch}
                    disabled={showProgress}
                />
            </span>
        </Tooltip>
    ) : (
        <Button onClick={confirmationToIndex} loading={esEnabled && !isBuilding}>
            {c('Action').t`Activate`}
        </Button>
    );
    const info = (
        <Info
            questionMark
            title={c('Tooltip')
                .t`This action will download all messages so they can be searched locally. Clearing your browser data will disable this option.`}
        />
    );
    const esHeader = indexKeyExists(user.ID) ? (
        <Label htmlFor="es-toggle" className="text-bold p0 pr1 flex flex-item-fluid flex-align-items-center">
            {esTitle}
            {info}
        </Label>
    ) : (
        <div className="text-bold p0 pr1 flex flex-item-fluid flex-align-items-center">
            {esTitle}
            {info}
        </div>
    );

    // Progress indicator
    const totalProgressToShow = Math.max(esProgress, getTotalFromBuildProgress(user.ID));
    let progressStatus: string = '';
    if (isPaused(user.ID)) {
        progressStatus = c('Info').t`Indexing paused`;
    } else if (isEstimating) {
        progressStatus = c('Info').t`Estimating time remaining...`;
    } else if (isRefreshing) {
        progressStatus = c('Info').t`Updating message content search...`;
    } else {
        // translator: esProgress is a number representing the current message being fetched, totalIndexingMessages is the total number of message in the mailbox
        progressStatus = c('Info').jt`Downloading message ${esProgress} out of ${totalProgressToShow}` as string;
    }

    const etaMessage =
        estimatedMinutes <= 1
            ? c('Info').t`Estimated time remaining: Less than a minute`
            : // translator: the variable is a positive integer (written in digits) always strictly bigger than 1
              c('Info').ngettext(
                  msgid`Estimated time remaining: ${estimatedMinutes} minute`,
                  `Estimated time remaining: ${estimatedMinutes} minutes`,
                  estimatedMinutes
              );
    const progressBar = (
        <Progress
            value={progressValue || 0}
            aria-describedby="timeRemaining"
            className={classnames([
                'mt1 mb1 flex-item-fluid',
                isPaused(user.ID) ? 'progress-bar--disabled' : undefined,
            ])}
        />
    );
    const disablePauseResumeButton = wasIndexingDone(user.ID) && isBuilding;
    const showPauseResumeButton = showProgress && (!wasIndexingDone(user.ID) || isBuilding) && !isRefreshing;
    const pauseResumeButton = isPaused(user.ID) ? (
        <Button
            shape="solid"
            color="norm"
            className="ml1 w25"
            onClick={resumeIndexing}
            disabled={disablePauseResumeButton}
        >
            {c('Action').t`Resume`}
        </Button>
    ) : (
        <Button className="ml1 w25" onClick={pauseIndexing} disabled={disablePauseResumeButton}>
            {c('Action').t`Pause`}
        </Button>
    );

    // Button to show advanced search options
    const showMoreTitle = showMore ? c('Action').t`Show less search options` : c('Action').t`Show more search options`;
    const showMoreText = showMore ? c('Action').t`Less search options` : c('Action').t`More search options`;
    const showMoreButton = (
        <div className="flex mb1">
            <LinkButton onClick={toggleShowMore} aria-expanded={showMore} title={showMoreTitle}>
                {showMoreText}
            </LinkButton>
        </div>
    );

    const dropdownSearchButtonProps = {
        ref: anchorRef,
        isOpen,
        hasCaret: false,
        disabled: loading,
        onClick: () => {
            void cacheIndexedDB();
            toggle();
        },
    };

    return (
        <>
            {isNarrow ? (
                <DropdownButton as={TopNavbarListItemSearchButton} {...dropdownSearchButtonProps} />
            ) : (
                <DropdownButton
                    as={Button}
                    icon
                    shape="ghost"
                    color="weak"
                    className="searchbox-advanced-search-button flex"
                    {...dropdownSearchButtonProps}
                >
                    <Icon
                        name="angle-down"
                        className={classnames(['searchbox-advanced-search-icon mauto', isOpen && 'rotateX-180'])}
                        alt={c('Action').t`Advanced search`}
                    />
                </DropdownButton>
            )}
            <Dropdown
                id={uid}
                originalPlacement="bottom-right"
                autoClose={false}
                autoCloseOutside={false}
                isOpen={isOpen}
                noMaxSize
                anchorRef={anchorRef}
                onClose={close}
                className="dropdown-content--wide advanced-search-dropdown"
                disableDefaultArrowNavigation
                UNSTABLE_AUTO_HEIGHT
            >
                <form
                    name="advanced-search"
                    className="pl1-5 pr1-5 pt1 pb1"
                    onSubmit={handleSubmit}
                    onReset={handleReset}
                >
                    {!showEncryptedSearch && (
                        <SearchField
                            value={model.keyword}
                            onChange={({ target }) => updateModel({ ...model, keyword: target.value })}
                            onSubmit={handleSubmit}
                            showEncryptedSearch={showEncryptedSearch}
                        />
                    )}
                    {showEncryptedSearch && (
                        <div className="pt1-5">
                            <div className="flex flex-column">
                                <div className="flex flew-nowrap mb0-5 flex-align-items-center">
                                    {esHeader}
                                    {esCTA}
                                </div>
                                {showSubTitleSection && subTitleSection}
                            </div>
                            {showProgress && (
                                <div className="mt0-5 flex flex-column">
                                    <span
                                        className="color-weak relative advanced-search-progress-status mb0-5"
                                        aria-live="polite"
                                        aria-atomic="true"
                                    >
                                        {progressStatus}
                                    </span>
                                    <div className="flex flex-justify-space-between">
                                        {progressBar}
                                        {showPauseResumeButton && pauseResumeButton}
                                    </div>
                                    <span
                                        id="timeRemaining"
                                        aria-live="polite"
                                        aria-atomic="true"
                                        className={classnames([
                                            'color-weak relative advanced-search-time-remaining mt0-5',
                                            isEstimating || isPaused(user.ID) ? 'visibility-hidden' : undefined,
                                        ])}
                                    >
                                        {etaMessage}
                                    </span>
                                </div>
                            )}
                            <hr className="mt1" />
                            {showMoreButton}
                        </div>
                    )}
                    {showAdvancedSearch && (
                        <>
                            {showEncryptedSearch && (
                                <SearchField
                                    value={model.keyword}
                                    onChange={({ target }) => updateModel({ ...model, keyword: target.value })}
                                    onSubmit={handleSubmit}
                                    showEncryptedSearch={showEncryptedSearch}
                                />
                            )}
                            <div className="mb0-5">
                                <Label className="advanced-search-label text-semibold" htmlFor="labelID">{c('Label')
                                    .t`Location`}</Label>
                                <Select
                                    id="labelID"
                                    value={model.labelID}
                                    options={labelIDOptions}
                                    onChange={({ target }) => updateModel({ ...model, labelID: target.value })}
                                />
                            </div>
                            <div className="mb0-5 flex flex-justify-space-between on-mobile-flex-column">
                                <div className="pr1 on-mobile-pr0 flex-item-fluid">
                                    <Label className="advanced-search-label text-semibold" htmlFor="begin-date">{c(
                                        'Label'
                                    ).t`From`}</Label>
                                    <DateInput
                                        placeholder={c('Placeholder').t`Start date`}
                                        id="begin-date"
                                        value={model.begin}
                                        onChange={async (begin) => {
                                            if (begin) {
                                                let oldestTime = -1;
                                                if (wasIndexingDone(user.ID) && isDBLimited) {
                                                    oldestTime = await getOldestTime(user.ID, 1000);
                                                }
                                                if (oldestTime !== -1 && isBefore(begin, oldestTime)) {
                                                    return;
                                                }
                                            }
                                            if (!model.end || isBefore(begin || -Infinity, model.end)) {
                                                updateModel({ ...model, begin });
                                            }
                                        }}
                                    />
                                </div>
                                <div className="flex-item-fluid">
                                    <Label className="advanced-search-label text-semibold" htmlFor="end-date">{c(
                                        'Label'
                                    ).t`To`}</Label>
                                    <DateInput
                                        placeholder={c('Placeholder').t`End date`}
                                        id="end-date"
                                        value={model.end}
                                        onChange={(end) =>
                                            (!model.begin || isAfter(end || Infinity, model.begin)) &&
                                            updateModel({ ...model, end })
                                        }
                                    />
                                </div>
                            </div>
                            <div className="mb0-5">
                                <Label
                                    title={c('Label').t`Sender`}
                                    className="advanced-search-label text-semibold"
                                    htmlFor="from"
                                >{c('Label').t`Sender`}</Label>
                                <AddressesInput
                                    id="from"
                                    recipients={model.from}
                                    onChange={(from) => updateModel({ ...model, from })}
                                    placeholder={c('Placeholder').t`Name or email address`}
                                />
                            </div>
                            <div className="mb0-5">
                                <Label
                                    title={c('Label').t`Recipient`}
                                    className="advanced-search-label text-semibold"
                                    htmlFor="to"
                                >{c('Label').t`Recipient`}</Label>
                                <AddressesInput
                                    id="to"
                                    recipients={model.to}
                                    onChange={(to) => updateModel({ ...model, to })}
                                    placeholder={c('Placeholder').t`Name or email address`}
                                />
                            </div>
                            <div className="mb1-5">
                                <Label
                                    className="advanced-search-label text-semibold"
                                    id="advanced-search-attachments-label"
                                >{c('Label').t`Attachments`}</Label>
                                <div className="pt0-5">
                                    <Radio
                                        id="advanced-search-attachments-all"
                                        onChange={() => updateModel({ ...model, attachments: UNDEFINED })}
                                        checked={model.attachments === UNDEFINED}
                                        name="advanced-search-attachments"
                                        aria-describedby="advanced-search-attachments-label"
                                        className="inline-flex mr1"
                                    >{c('Attachment radio advanced search').t`All`}</Radio>
                                    <Radio
                                        id="advanced-search-attachments-yes"
                                        onChange={() => updateModel({ ...model, attachments: WITH_ATTACHMENTS })}
                                        checked={model.attachments === WITH_ATTACHMENTS}
                                        name="advanced-search-attachments"
                                        aria-describedby="advanced-search-attachments-label"
                                        className="inline-flex mr1"
                                    >{c('Attachment radio advanced search').t`With`}</Radio>
                                    <Radio
                                        id="advanced-search-attachments-no"
                                        onChange={() => updateModel({ ...model, attachments: NO_ATTACHMENTS })}
                                        checked={model.attachments === NO_ATTACHMENTS}
                                        name="advanced-search-attachments"
                                        aria-describedby="advanced-search-attachments-label"
                                    >{c('Attachment radio advanced search').t`Without`}</Radio>
                                </div>
                            </div>
                            <div className="flex flex-justify-space-between">
                                <Button disabled={!Object.keys(model).length} type="reset">{c('Action')
                                    .t`Clear`}</Button>
                                <PrimaryButton type="submit">{c('Action').t`Search`}</PrimaryButton>
                            </div>
                        </>
                    )}
                </form>
            </Dropdown>
        </>
    );
};

export default AdvancedSearchDropdown;
