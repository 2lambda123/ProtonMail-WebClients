import React, { useRef, useState, useEffect, memo } from 'react';
import { c } from 'ttag';
import { Location, History } from 'history';
import {
    Searchbox,
    useLabels,
    useFolders,
    PrivateHeader,
    FloatingButton,
    MainLogo,
    TopNavbarListItemSettingsDropdown,
    TopNavbarListItemContactsDropdown,
    TopNavbarListItemFeedbackButton,
    FeedbackModal,
    Icon,
    useFeature,
    FeatureCode,
} from '@proton/components';
import { MAILBOX_LABEL_IDS, APPS } from '@proton/shared/lib/constants';
import { Recipient } from '@proton/shared/lib/interfaces';
import AdvancedSearchDropdown from './AdvancedSearchDropdown';
import { extractSearchParameters, setParamsInUrl } from '../../helpers/mailboxUrl';
import { Breakpoints } from '../../models/utils';
import { getLabelName } from '../../helpers/labels';
import { useEncryptedSearchContext } from '../../containers/EncryptedSearchProvider';
import { useOnCompose, useOnMailTo } from '../../containers/ComposeProvider';
import { MESSAGE_ACTIONS } from '../../constants';

interface Props {
    labelID: string;
    elementID: string | undefined;
    location: Location;
    history: History;
    breakpoints: Breakpoints;
    onSearch: (keyword?: string, labelID?: string) => void;
    expanded?: boolean;
    onToggleExpand: () => void;
}

const MailHeader = ({
    labelID,
    elementID,
    location,
    history,
    breakpoints,
    expanded,
    onToggleExpand,
    onSearch,
}: Props) => {
    const { keyword = '' } = extractSearchParameters(location);
    const [value, updateValue] = useState(keyword);
    const oldLabelIDRef = useRef<string>(MAILBOX_LABEL_IDS.INBOX);
    const [labels = []] = useLabels();
    const [folders = []] = useFolders();
    const { feature: featureMailFeedbackEnabled } = useFeature(FeatureCode.MailFeedbackEnabled);
    const { cacheIndexedDB } = useEncryptedSearchContext();

    const onCompose = useOnCompose();
    const onMailTo = useOnMailTo();

    // Update the search input field when the keyword in the url is changed
    useEffect(() => updateValue(keyword), [keyword]);

    const searchDropdown = <AdvancedSearchDropdown keyword={value} isNarrow={breakpoints.isNarrow} />;

    const searchBox = (
        <Searchbox
            delay={0}
            placeholder={c('Placeholder').t`Search messages`}
            onSearch={(keyword) => {
                if (keyword) {
                    oldLabelIDRef.current = labelID;
                }
                onSearch(keyword, keyword ? undefined : oldLabelIDRef.current);
            }}
            onChange={updateValue}
            value={value}
            advanced={searchDropdown}
            onFocus={() => cacheIndexedDB()}
        />
    );

    const handleContactsCompose = (emails: Recipient[], attachments: File[]) => {
        onCompose({
            action: MESSAGE_ACTIONS.NEW,
            referenceMessage: { data: { ToList: emails }, initialAttachments: attachments },
        });
    };

    const backUrl = setParamsInUrl(history.location, { labelID });
    const showBackButton = breakpoints.isNarrow && elementID;
    const labelName = getLabelName(labelID, labels, folders);
    const logo = <MainLogo to="/inbox" />;

    return (
        <PrivateHeader
            logo={logo}
            backUrl={showBackButton && backUrl ? backUrl : undefined}
            title={labelName}
            settingsButton={<TopNavbarListItemSettingsDropdown to="/mail/general" toApp={APPS.PROTONACCOUNT} />}
            contactsButton={<TopNavbarListItemContactsDropdown onCompose={handleContactsCompose} onMailTo={onMailTo} />}
            feedbackButton={
                featureMailFeedbackEnabled?.Value ? (
                    <TopNavbarListItemFeedbackButton
                        modal={
                            <FeedbackModal
                                feedbackType="v4_migration"
                                description={c('Info')
                                    .t`Proton has received a facelift. We would love to hear what you think about it!`}
                                scaleTitle={c('Label').t`How would you rate your experience with the new ProtonMail?`}
                            />
                        }
                    />
                ) : null
            }
            searchBox={searchBox}
            searchDropdown={searchDropdown}
            expanded={!!expanded}
            onToggleExpand={onToggleExpand}
            isNarrow={breakpoints.isNarrow}
            floatingButton={
                <FloatingButton onClick={() => onCompose({ action: MESSAGE_ACTIONS.NEW })}>
                    <Icon size={24} name="compose" className="mauto" />
                </FloatingButton>
            }
        />
    );
};

export default memo(MailHeader);
