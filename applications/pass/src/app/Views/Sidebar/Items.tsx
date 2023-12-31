import { type FC, useEffect } from 'react';

import { useNavigation } from '@proton/pass/components/Core/NavigationProvider';
import { getLocalPath, maybeTrash } from '@proton/pass/components/Core/routing';
import { SortFilter } from '@proton/pass/components/Item/Filters/Sort';
import { TypeFilter } from '@proton/pass/components/Item/Filters/Type';
import { ItemsList } from '@proton/pass/components/Item/List/ItemsList';
import { ItemsListPlaceholder } from '@proton/pass/components/Item/List/ItemsList.Placeholder';
import { useFilteredItems } from '@proton/pass/hooks/useFilteredItems';
import { itemEq } from '@proton/pass/lib/items/item.predicates';

export const Items: FC = () => {
    const { filters, matchEmpty, matchTrash, selectedItem, setFilters, selectItem, navigate } = useNavigation();
    const shareId = selectedItem?.shareId;
    const itemId = selectedItem?.itemId;
    const items = useFilteredItems({ ...filters, trashed: matchTrash });

    useEffect(() => {
        const itemNotInFilters = itemId && shareId && !items.filtered.some(itemEq({ itemId, shareId }));
        const emptyRouteButResults = matchEmpty && items.filtered.length > 0;
        if (itemNotInFilters || emptyRouteButResults) navigate(getLocalPath(maybeTrash('', matchTrash)));
    }, [items, itemId, shareId, matchEmpty, matchTrash]);

    return (
        <>
            {!matchTrash && items.totalCount > 0 && (
                <div className="flex flex-row grow-0 shrink-0 flex-nowrap p-3 gap-1 overflow-x-auto">
                    <TypeFilter items={items.searched} value={filters.type} onChange={(type) => setFilters({ type })} />
                    <SortFilter value={filters.sort} onChange={(sort) => setFilters({ sort })} />
                </div>
            )}

            <ItemsList
                filters={filters}
                items={items.filtered}
                totalCount={items.totalCount}
                onFilter={setFilters}
                onSelect={(shareId, itemId) => selectItem(shareId, itemId, { inTrash: matchTrash })}
                selectedItem={selectedItem}
                placeholder={() => <ItemsListPlaceholder noImport />}
            />
        </>
    );
};
