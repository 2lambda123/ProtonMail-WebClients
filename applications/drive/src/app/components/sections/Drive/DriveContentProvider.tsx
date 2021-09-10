import { useState, createContext, useEffect, useContext, useRef, useCallback } from 'react';
import * as React from 'react';

import { SORT_DIRECTION } from '@proton/shared/lib/constants';

import { STATUS_CODE } from '../../../constants';
import { SortKeys } from '../../../interfaces/link';
import { DriveFolder, useActiveShare } from '../../../hooks/drive/useActiveShare';
import useDrive from '../../../hooks/drive/useDrive';
import useDriveSorting from '../../../hooks/drive/useDriveSorting';
import useNavigate from '../../../hooks/drive/useNavigate';
import useSelection from '../../../hooks/util/useSelection';
import { useDriveCache } from '../../DriveCache/DriveCacheProvider';
import { FileBrowserItem } from '../../FileBrowser/interfaces';
import { mapLinksToChildren } from '../helpers';

export interface DriveSortParams {
    sortField: SortKeys;
    sortOrder: SORT_DIRECTION;
}

interface DriveContentProviderState {
    contents: FileBrowserItem[];
    loadNextPage: () => void;
    setSorting: (sortField: SortKeys, sortOrder: SORT_DIRECTION) => void;
    sortParams: { sortField: SortKeys; sortOrder: SORT_DIRECTION };
    fileBrowserControls: Omit<ReturnType<typeof useSelection>, 'selectedItems'> & {
        selectedItems: FileBrowserItem[];
    };
    loading: boolean;
    complete?: boolean;
}

const DriveContentContext = createContext<DriveContentProviderState | null>(null);

const DriveContentProviderInner = ({
    children,
    activeFolder: { linkId, shareId },
}: {
    children: React.ReactNode;
    activeFolder: DriveFolder;
}) => {
    const cache = useDriveCache();
    const { fetchNextFolderContents, fetchAllFolderPagesWithLoader } = useDrive();
    const [loading, setLoading] = useState(false);
    const [, setError] = useState();
    const { navigateToRoot } = useNavigate();

    const { sortParams, sortedList, setSorting } = useDriveSorting(
        (sortParams) => cache.get.childLinkMetas(shareId, linkId, sortParams) || []
    );
    const contents = mapLinksToChildren(sortedList, (linkId) => cache.get.isLinkLocked(shareId, linkId));
    const complete = cache.get.childrenComplete(shareId, linkId, sortParams);

    const selectionControls = useSelection(
        contents.map((data) => ({
            id: data.LinkID,
            disabled: data.Disabled,
            data,
        }))
    );
    const fileBrowserControls = {
        ...selectionControls,
        selectedItems: selectionControls.selectedItems.map(({ data }) => data),
    };
    const abortSignal = useRef<AbortSignal>();
    const contentLoading = useRef(false);

    const loadNextPage = useCallback(async (): Promise<void> => {
        if (contentLoading.current || complete) {
            return;
        }

        contentLoading.current = true;
        setLoading(true);

        const signal = abortSignal.current;

        try {
            if (sortParams.sortField === 'Name') {
                await fetchAllFolderPagesWithLoader(shareId, linkId);
            } else {
                await fetchNextFolderContents(shareId, linkId, sortParams);
            }
            if (!signal?.aborted) {
                contentLoading.current = false;
                setLoading(false);
            }
        } catch (e: any) {
            const children = cache.get.childLinks(shareId, linkId, sortParams);

            if (signal?.aborted) {
                return;
            }

            contentLoading.current = false;
            if (!children?.length) {
                if (e.status === STATUS_CODE.NOT_FOUND) {
                    navigateToRoot();
                } else {
                    // Will by handled by AppErrorBoundary.
                    setError(() => {
                        throw e;
                    });
                }
            } else if (!signal?.aborted) {
                setLoading(false);
            }
        }
    }, [shareId, linkId, sortParams, sortParams]);

    useEffect(() => {
        const isInitialized = cache.get.childrenInitialized(shareId, linkId, sortParams);
        const hasChildren = !!cache.get.listedChildLinks(shareId, linkId)?.length;

        const abortController = new AbortController();

        abortSignal.current = abortController.signal;
        fileBrowserControls.clearSelections();

        if (loading) {
            setLoading(false);
        }

        if (!isInitialized || !hasChildren) {
            loadNextPage().catch(console.error);
            return () => {
                contentLoading.current = false;
                abortController.abort();
            };
        }
    }, [loadNextPage, shareId, linkId, sortParams]);

    return (
        <DriveContentContext.Provider
            value={{
                loading,
                fileBrowserControls,
                loadNextPage,
                setSorting,
                sortParams,
                contents,
                complete,
            }}
        >
            {children}
        </DriveContentContext.Provider>
    );
};

/**
 * Stores loaded links as file browser content items.
 * Stores file browser controls.
 * Exposes functions to (re)load open folder contents.
 */
const DriveContentProvider = ({ children, folder }: { children: React.ReactNode; folder?: DriveFolder }) => {
    const { activeFolder } = useActiveShare();

    const currentFolder = folder || activeFolder;

    return currentFolder ? (
        <DriveContentProviderInner activeFolder={currentFolder}>{children}</DriveContentProviderInner>
    ) : (
        <>{children}</>
    );
};

export const useDriveContent = () => {
    const state = useContext(DriveContentContext);
    if (!state) {
        throw new Error('Trying to use uninitialized DriveContentProvider');
    }
    return state;
};

export default DriveContentProvider;
