import React, { useState, useMemo, useEffect } from 'react';
import { c } from 'ttag';
import {
    Alert,
    ButtonGroup,
    Group,
    Href,
    useApiResult,
    useApiWithoutResult,
    Button,
    Block,
    useUser,
    Tooltip,
    useSortedList,
    useUserVPN,
    Radio,
    RadioGroup
} from 'react-components';
import { queryVPNLogicalServerInfo, getVPNServerConfig } from 'proton-shared/lib/api/vpn';
import ConfigsTable, { CATEGORY } from './ConfigsTable';
import { isSecureCoreEnabled } from './utils';
import { groupWith } from 'proton-shared/lib/helpers/array';
import ServerConfigs from './ServerConfigs';
import downloadFile from 'proton-shared/lib/helpers/downloadFile';
import { getCountryByAbbr, correctAbbr } from 'react-components/helpers/countries';
import { SORT_DIRECTION } from 'proton-shared/lib/constants';
import { Link } from 'react-router-dom';

const PLATFORM = {
    MACOS: 'macOS',
    LINUX: 'Linux',
    WINDOWS: 'Windows',
    ANDROID: 'Android',
    IOS: 'iOS',
    ROUTER: 'Router'
};

const PROTOCOL = {
    TCP: 'tcp',
    UDP: 'udp'
};

const OpenVPNConfigurationSection = () => {
    const [platform, setPlatform] = useState(PLATFORM.ANDROID);
    const [protocol, setProtocol] = useState(PROTOCOL.UDP);
    const [category, setCategory] = useState(CATEGORY.SECURE_CORE);
    const { request } = useApiWithoutResult(getVPNServerConfig);
    const { loading, result = {} } = useApiResult(queryVPNLogicalServerInfo, []);
    const { result: vpnResult = {}, loading: vpnLoading } = useUserVPN();
    const [{ hasPaidVpn }] = useUser();
    const { VPN: userVPN = {} } = vpnResult;
    const isBasicVPN = userVPN.PlanName === 'vpnbasic';

    const downloadAllConfigs = async () => {
        const buffer = await request({
            Category: category === CATEGORY.FREE ? CATEGORY.SERVER : category,
            Platform: platform,
            Protocol: protocol,
            Tier: userVPN.PlanName === 'trial' || category === CATEGORY.FREE ? 0 : userVPN.MaxTier
        });
        const blob = new Blob([buffer], { type: 'application/zip' });
        downloadFile(blob, 'ProtonVPN_server_configs.zip');
    };

    const handleSelectConfig = (option) => () => setCategory(option);

    const servers = useMemo(
        () =>
            (result.LogicalServers || []).map((server) => {
                return {
                    ...server,
                    Country: getCountryByAbbr(correctAbbr(server.ExitCountry))
                };
            }),
        [result.LogicalServers]
    );

    const { sortedList: allServers } = useSortedList(servers, { key: 'Country', direction: SORT_DIRECTION.ASC });

    const secureCoreServers = allServers.filter(({ Features }) => isSecureCoreEnabled(Features));
    const countryServers = groupWith(
        (a, b) => a.ExitCountry === b.ExitCountry,
        allServers.filter(({ Tier }) => Tier === 1)
    ).map((groups) => {
        const [first] = groups;
        const activeServers = groups.filter(({ Status }) => Status === 1);
        const load = activeServers.reduce((acc, { Load }) => acc + Load, 0) / activeServers.length;
        return {
            ...first,
            Load: isNaN(load) ? 0 : Math.round(load),
            Domain: `${first.EntryCountry.toLowerCase()}.protonvpn.com`, // Forging domain
            Servers: groups.reduce((acc, { Servers = [] }) => (acc.push(...Servers), acc), [])
        };
    });
    const freeServers = allServers.filter(({ Tier }) => Tier === 0).map((server) => ({ ...server, open: true }));

    const isUpgradeRequiredForSecureCore = () => !Object.keys(userVPN).length || !hasPaidVpn || isBasicVPN;
    const isUpgradeRequiredForCountries = () => !Object.keys(userVPN).length || !hasPaidVpn;
    const isUpgradeRequiredForDownloadAll =
        !Object.keys(userVPN).length ||
        (!hasPaidVpn && ![CATEGORY.SERVER, CATEGORY.FREE].includes(category)) ||
        (isBasicVPN && category === CATEGORY.SECURE_CORE);

    useEffect(() => {
        if (!hasPaidVpn || userVPN.PlanName === 'trial') {
            setCategory(CATEGORY.FREE);
        }
    }, [vpnLoading]);

    return (
        <>
            <Alert>
                {c('Info').t`Use this section to generate config files for third party VPN clients
                    or when setting up a connection on a router. If you use a native ProtonVPN
                    client to connect, you do not need to manually handle these configuration files.
                `}
            </Alert>

            <h3 className="mt2">{c('Title').t`1. Select platform`}</h3>
            <div className="flex onmobile-flex-column mb1">
                {[
                    {
                        value: PLATFORM.ANDROID,
                        link: 'https://protonvpn.com/support/android-vpn-setup/',
                        label: c('Option').t`Android`
                    },
                    {
                        value: PLATFORM.IOS,
                        link: 'https://protonvpn.com/support/ios-vpn-setup/',
                        label: c('Option').t`iOS`
                    },
                    {
                        value: PLATFORM.WINDOWS,
                        link: 'https://protonvpn.com/support/openvpn-windows-setup/',
                        label: c('Option').t`Windows`
                    },
                    {
                        value: PLATFORM.MACOS,
                        link: 'https://protonvpn.com/support/mac-vpn-setup/',
                        label: c('Option').t`MacOS`
                    },
                    {
                        value: PLATFORM.LINUX,
                        link: 'https://protonvpn.com/support/linux-vpn-setup/',
                        label: c('Option').t`GNU/Linux`
                    },
                    {
                        value: PLATFORM.ROUTER,
                        link: 'https://protonvpn.com/support/installing-protonvpn-on-a-router/',
                        label: c('Option').t`Router`
                    }
                ].map(({ value, label, link }) => {
                    return (
                        <div key={value} className="mr2">
                            <Radio
                                onChange={() => setPlatform(value)}
                                checked={platform === value}
                                name="platform"
                                className="flex inline-flex-vcenter mb0-5"
                            >
                                {label}
                            </Radio>
                            <Href url={link} className="small m0 bl" style={{ paddingLeft: '2.1rem' }}>{c('Link')
                                .t`View guide`}</Href>
                        </div>
                    );
                })}
            </div>

            <h3 className="mt2">{c('Title').t`2. Select protocol`}</h3>
            <div className="flex onmobile-flex-column mb0-5">
                <RadioGroup
                    name="protocol"
                    value={protocol}
                    onChange={setProtocol}
                    options={[
                        { value: PROTOCOL.UDP, label: c('Option').t`UDP` },
                        { value: PROTOCOL.TCP, label: c('Option').t`TCP` }
                    ]}
                />
            </div>
            <div className="mb1">
                <Href url="https://protonvpn.com/support/udp-tcp/" className="small m0">{c('Link')
                    .t`What is the difference between UDP and TCP protocols?`}</Href>
            </div>

            <h3 className="mt2">{c('Title').t`3. Select connection and download`}</h3>
            <Group className="mb1-5">
                <ButtonGroup
                    onClick={handleSelectConfig(CATEGORY.SECURE_CORE)}
                    className={category === CATEGORY.SECURE_CORE ? 'is-active' : ''}
                >{c('Tab').t`Secure Core configs`}</ButtonGroup>
                <ButtonGroup
                    onClick={handleSelectConfig(CATEGORY.COUNTRY)}
                    className={category === CATEGORY.COUNTRY ? 'is-active' : ''}
                >{c('Tab').t`Country configs`}</ButtonGroup>
                <ButtonGroup
                    onClick={handleSelectConfig(CATEGORY.SERVER)}
                    className={category === CATEGORY.SERVER ? 'is-active' : ''}
                >{c('Tab').t`Standard server configs`}</ButtonGroup>
                <ButtonGroup
                    onClick={handleSelectConfig(CATEGORY.FREE)}
                    className={category === CATEGORY.FREE ? 'is-active' : ''}
                >{c('Tab').t`Free server configs`}</ButtonGroup>
            </Group>

            <Block>
                {category === CATEGORY.SECURE_CORE && (
                    <>
                        <Alert learnMore="https://protonvpn.com/support/secure-core-vpn">
                            {c('Info')
                                .t`Install a Secure Core configuration file to benefit from an additional protection against VPN endpoint compromise.`}
                        </Alert>
                        {isUpgradeRequiredForSecureCore() && (
                            <Alert>
                                <div>{c('Info').t`ProtonVPN Plus or Visionary required for Secure Core feature.`}</div>
                                <Link to="/dashboard">{c('Link').t`Learn more`}</Link>
                            </Alert>
                        )}
                        <ConfigsTable
                            category={CATEGORY.SECURE_CORE}
                            isUpgradeRequired={isUpgradeRequiredForSecureCore}
                            platform={platform}
                            protocol={protocol}
                            loading={loading}
                            servers={secureCoreServers}
                        />
                    </>
                )}
                {category === CATEGORY.COUNTRY && (
                    <>
                        <Alert>
                            {c('Info')
                                .t`Install a Country configuration file to connect to a random server in the country of your choice.`}
                        </Alert>
                        {isUpgradeRequiredForCountries() && (
                            <Alert learnMore="https://account.protonvpn.com/dashboard">{c('Info')
                                .t`ProtonVPN Basic, Plus or Visionary required for Country level connection.`}</Alert>
                        )}
                        <ConfigsTable
                            category={CATEGORY.COUNTRY}
                            isUpgradeRequired={isUpgradeRequiredForCountries}
                            platform={platform}
                            protocol={protocol}
                            loading={loading}
                            servers={countryServers}
                        />
                    </>
                )}
                {category === CATEGORY.SERVER && (
                    <>
                        <Alert>{c('Info')
                            .t`Install a Server configuration file to connect to a specific server in the country of your choice.`}</Alert>
                        <ServerConfigs
                            category={category}
                            platform={platform}
                            protocol={protocol}
                            loading={loading}
                            servers={allServers}
                        />
                    </>
                )}
                {category === CATEGORY.FREE && (
                    <>
                        <Alert>{c('Info')
                            .t`Install a Free server configuration file to connect to a specific server in one of the three free locations.`}</Alert>
                        <ServerConfigs
                            category={category}
                            platform={platform}
                            protocol={protocol}
                            loading={loading}
                            servers={freeServers}
                        />
                    </>
                )}
                {isUpgradeRequiredForDownloadAll ? (
                    <Tooltip title={c('Info').t`Plan upgrade required`}>
                        <Button loading={vpnLoading} disabled>{c('Action').t`Download all configurations`}</Button>
                    </Tooltip>
                ) : (
                    <Button loading={vpnLoading} onClick={() => downloadAllConfigs()}>{c('Action')
                        .t`Download all configurations`}</Button>
                )}
            </Block>
        </>
    );
};

export default OpenVPNConfigurationSection;
