import { ComponentPropsWithRef, forwardRef } from 'react';

import { CircleLoader } from '@proton/atoms';
import clsx from '@proton/utils/clsx';

export interface Props extends Omit<ComponentPropsWithRef<'button'>, 'color'> {
    loading?: boolean;
    isSelected?: boolean;
    /*
     * Used by DropdownMenu to add CSS classes to the parent li
     */
    liClassName?: string;
    actionType?: 'delete';
    'data-testid'?: string;
}

const DropdownMenuButton = forwardRef<HTMLButtonElement, Props>(
    (
        {
            className = '',
            isSelected,
            disabled,
            loading,
            children,
            liClassName, // eslint-disable-line no-unused-vars, @typescript-eslint/no-unused-vars
            actionType, // eslint-disable-line no-unused-vars, @typescript-eslint/no-unused-vars
            ...rest
        },
        ref
    ) => {
        return (
            <button
                ref={ref}
                type="button"
                disabled={disabled || loading}
                className={clsx([
                    'dropdown-item-button w-full px-4 py-2',
                    isSelected && 'dropdown-item--is-selected',
                    className,
                ])}
                aria-busy={loading}
                {...rest}
            >
                {loading ? (
                    <div className="flex items-center flex-nowrap">
                        <span className="flex-1 text-ellipsis">{children}</span>
                        <CircleLoader className="shrink-0" />
                    </div>
                ) : (
                    children
                )}
            </button>
        );
    }
);

DropdownMenuButton.displayName = 'DropdownMenuButton';

export default DropdownMenuButton;
