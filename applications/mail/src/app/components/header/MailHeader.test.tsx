import { fireEvent } from '@testing-library/react';
import { screen } from '@testing-library/react';
import loudRejection from 'loud-rejection';

import { MAILBOX_LABEL_IDS } from '@proton/shared/lib/constants';
import { mockDefaultBreakpoints } from '@proton/testing/lib/mockUseActiveBreakpoint';

import {
    addApiMock,
    addToCache,
    clearAll,
    getDropdown,
    getHistory,
    minimalCache,
    render,
    tick,
} from '../../helpers/test/helper';
import MailHeader from './MailHeader';

loudRejection();

const getProps = () => ({
    labelID: 'labelID',
    elementID: undefined,
    selectedIDs: [],
    location: getHistory().location,
    history: getHistory(),
    breakpoints: mockDefaultBreakpoints,
    onSearch: jest.fn(),
    expanded: true,
    onToggleExpand: jest.fn(),
    onOpenShortcutsModal: jest.fn(),
});

const user = {
    Email: 'Email',
    DisplayName: 'DisplayName',
    Name: 'Name',
    isFree: true,
    UsedSpace: 10,
    MaxSpace: 100,
};

describe('MailHeader', () => {
    let props: ReturnType<typeof getProps>;

    const setup = async () => {
        minimalCache();
        addToCache('User', user);
        addApiMock('payments/v4/plans', () => ({}));
        addApiMock('contacts/v4/contacts', () => ({ Contacts: [] }));
        addApiMock('payments/v4/subscription/latest', () => ({}));

        props = getProps();

        const result = await render(<MailHeader {...props} />, false);
        const search = result.getByTitle('Search');

        const openSearch = async () => {
            fireEvent.click(search);
            await tick();
            const overlay = document.querySelector('div[role="dialog"].overlay') as HTMLDivElement;
            const submitButton = overlay.querySelector('button[type="submit"]') as HTMLButtonElement;
            const submit = () => fireEvent.click(submitButton);
            return { overlay, submitButton, submit };
        };

        return { ...result, openSearch };
    };

    // Not found better to test
    // It's hard to override sso mode constant
    const assertAppLink = (element: HTMLElement, href: string) => {
        const link = element.closest('a');
        expect(link?.getAttribute('href')).toBe(href);
    };

    afterEach(clearAll);

    describe('Core features', () => {
        it('should open user dropdown', async () => {
            const { getByText: getByTextHeader } = await setup();

            const userButton = getByTextHeader(user.DisplayName);
            fireEvent.click(userButton);

            const dropdown = await getDropdown();
            const { textContent } = dropdown;

            expect(textContent).toContain('Proton shop');
            expect(textContent).toContain('Sign out');
        });

        it('should show upgrade button', async () => {
            const { getByTestId } = await setup();

            const upgradeLabel = getByTestId('cta:upgrade-plan');

            assertAppLink(upgradeLabel, '/mail/upgrade?ref=upsell_mail-button-1');
        });
    });

    describe('Search features', () => {
        it('should search with keyword', async () => {
            const searchTerm = 'test';

            const { getByTestId, openSearch, rerender } = await setup();
            const { submit } = await openSearch();

            const keywordInput = document.getElementById('search-keyword') as HTMLInputElement;
            fireEvent.change(keywordInput, { target: { value: searchTerm } });

            submit();

            const history = getHistory();
            expect(history.length).toBe(2);
            expect(history.location.pathname).toBe('/all-mail');
            expect(history.location.hash).toBe(`#keyword=${searchTerm}`);

            await rerender(<MailHeader {...props} />);

            const searchKeyword = getByTestId('search-keyword') as HTMLInputElement;
            expect(searchKeyword.value).toBe(searchTerm);
        });

        it('should search with keyword and location', async () => {
            const searchTerm = 'test';

            const { openSearch } = await setup();
            const { submit } = await openSearch();

            const keywordInput = document.getElementById('search-keyword') as HTMLInputElement;
            fireEvent.change(keywordInput, { target: { value: searchTerm } });

            const draftButton = screen.getByTestId(`location-${MAILBOX_LABEL_IDS.DRAFTS}`);
            fireEvent.click(draftButton);

            submit();

            const history = getHistory();
            expect(history.length).toBe(2);
            expect(history.location.pathname).toBe('/drafts');
            expect(history.location.hash).toBe(`#keyword=${searchTerm}`);
        });
    });
});
