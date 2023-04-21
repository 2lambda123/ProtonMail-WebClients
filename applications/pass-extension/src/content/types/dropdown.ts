import type { AliasState } from '@proton/pass/store';
import type { Maybe, Realm, SafeLoginItem } from '@proton/pass/types';

import type { FieldHandles, FormField, FormType } from './form';
import type { IFrameService } from './iframe';

export enum DropdownAction {
    AUTOFILL,
    AUTOSUGGEST_PASSWORD,
    AUTOSUGGEST_ALIAS,
}

export type DropdownSetActionPayload =
    | { action: DropdownAction.AUTOFILL; items: SafeLoginItem[] }
    | { action: DropdownAction.AUTOSUGGEST_PASSWORD }
    | { action: DropdownAction.AUTOSUGGEST_ALIAS; options: AliasState['aliasOptions']; realm: Realm };

export type DropdownState = { field: Maybe<FieldHandles<FormType, FormField>> };

export type OpenDropdownOptions = {
    field: FieldHandles;
    action: DropdownAction;
    focus?: boolean;
};

export interface InjectedDropdown extends IFrameService<OpenDropdownOptions> {}