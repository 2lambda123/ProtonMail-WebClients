import type { VFC } from 'react';

import { ItemEffects } from 'proton-pass-extension/lib/components/Context/Items/ItemEffects';
import {
    ItemsFilteringContext,
    ItemsFilteringContextProvider,
} from 'proton-pass-extension/lib/components/Context/Items/ItemsFilteringContext';
import { NavigationContextProvider } from 'proton-pass-extension/lib/components/Context/Navigation/NavigationContext';
import { usePopupContext } from 'proton-pass-extension/lib/hooks/usePopupContext';

import { InviteProvider } from '@proton/pass/components/Invite/InviteProvider';
import { PasswordProvider } from '@proton/pass/components/Password/PasswordProvider';
import { SpotlightProvider } from '@proton/pass/components/Spotlight/SpotlightProvider';

import { Lobby } from './Views/Lobby/Lobby';
import { Main } from './Views/Main';

export const App: VFC = () => {
    const { state, initialized } = usePopupContext();

    /* navigate away from the `Lobby` only when the worker
     * is in a ready & logged in state and the popup context
     * is initialized (initial popup state was resolved) */
    return state.loggedIn && initialized ? (
        <NavigationContextProvider>
            <ItemsFilteringContextProvider>
                <ItemsFilteringContext.Consumer>
                    {({ setShareId }) => (
                        <InviteProvider onVaultCreated={setShareId}>
                            <ItemEffects />
                            <PasswordProvider>
                                <SpotlightProvider>
                                    <Main />
                                </SpotlightProvider>
                            </PasswordProvider>
                        </InviteProvider>
                    )}
                </ItemsFilteringContext.Consumer>
            </ItemsFilteringContextProvider>
        </NavigationContextProvider>
    ) : (
        <Lobby />
    );
};
