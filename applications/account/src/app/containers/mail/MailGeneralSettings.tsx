import { c } from 'ttag';

import {
    MessagesSection,
    MailGeneralAdvancedSection,
    SettingsPropsShared,
    PmMeSection,
    useAddresses,
    useFeature,
    FeatureCode,
    SpyTrackerTemporarySection,
} from '@proton/components';

import { ADDRESS_TYPE } from '@proton/shared/lib/constants';
import { UserModel } from '@proton/shared/lib/interfaces';
import isTruthy from '@proton/shared/lib/helpers/isTruthy';
import { getHasOnlyExternalAddresses } from '@proton/shared/lib/helpers/address';

import PrivateMainSettingsAreaWithPermissions from '../../components/PrivateMainSettingsAreaWithPermissions';
import PrivateMainAreaLoading from '../../components/PrivateMainAreaLoading';

export const getGeneralPage = (user: UserModel, showPmMeSection: boolean) => {
    return {
        text: c('Title').t`General`,
        to: '/mail/general',
        icon: 'sliders',
        subsections: [
            showPmMeSection && {
                text: c('Title').t`Short domain (@pm.me)`,
                id: 'pmme',
            },
            {
                text: c('Title').t`Messages`,
                id: 'messages',
            },
            {
                text: c('Title').t`Advanced`,
                id: 'advanced',
            },
            {
                text: c('Title').t`Spy Tracker Protection`,
                id: 'spy-tracker',
            },
        ].filter(isTruthy),
    };
};

interface Props extends SettingsPropsShared {
    user: UserModel;
}

const MailGeneralSettings = ({ location, user }: Props) => {
    const [addresses, loading] = useAddresses();
    const { feature } = useFeature(FeatureCode.SpyTrackerProtection);

    if (loading && !Array.isArray(addresses)) {
        return <PrivateMainAreaLoading />;
    }

    const { hasPaidMail, canPay } = user;
    const isExternalUser = getHasOnlyExternalAddresses(addresses);
    const isPMAddressActive = addresses.some(({ Type }) => Type === ADDRESS_TYPE.TYPE_PREMIUM);
    const hasNoOriginalAddresses = !addresses.some(({ Type }) => Type === ADDRESS_TYPE.TYPE_ORIGINAL);
    const showPmMeSection = !isExternalUser && canPay && !hasNoOriginalAddresses && !(isPMAddressActive && hasPaidMail);

    return (
        <PrivateMainSettingsAreaWithPermissions location={location} config={getGeneralPage(user, showPmMeSection)}>
            {showPmMeSection && <PmMeSection isPMAddressActive={isPMAddressActive} />}
            <MessagesSection />
            <MailGeneralAdvancedSection />
            {feature?.Value ? <SpyTrackerTemporarySection /> : null}
        </PrivateMainSettingsAreaWithPermissions>
    );
};

export default MailGeneralSettings;
