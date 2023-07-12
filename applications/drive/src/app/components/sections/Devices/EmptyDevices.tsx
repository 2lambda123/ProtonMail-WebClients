import React, { useEffect, useState } from 'react';

import { c } from 'ttag';

import { EmptyViewContainer, Icon, PrimaryButton } from '@proton/components';
import { fetchDesktopVersion } from '@proton/shared/lib/apps/desktopVersions';
import { DESKTOP_APP_NAMES, DESKTOP_PLATFORMS, RELEASE_CATEGORIES } from '@proton/shared/lib/constants';
import emptyDevicesImg from '@proton/styles/assets/img/illustrations/empty-devices.png';

import { logError } from '../../../utils/errorHandling';

const EmptyDevices = () => {
    const [downloadUrl, setDownloadUrl] = useState<string | undefined>(undefined);

    useEffect(() => {
        fetchDesktopVersion({
            appName: DESKTOP_APP_NAMES.DRIVE,
            version: 'latest',
            platform: DESKTOP_PLATFORMS.WINDOWS,
            category: RELEASE_CATEGORIES.STABLE,
        }).then(
            (result) => setDownloadUrl(result?.url),
            (reason) => logError(`Download link cannot be fetched\n${reason}`)
        );
    }, []);

    const downloadDisabled = !downloadUrl;

    const syncFoldersText = c('Info').t`Sync folders from your computer`;
    const downloadText = c('Action').t`Download Drive for Windows`;

    const startDownload = () => {
        if (!downloadUrl) {
            logError('Trying download without download url.');
            return;
        }
        window.location.href = downloadUrl;
    };

    return (
        <EmptyViewContainer imageProps={{ src: emptyDevicesImg, alt: syncFoldersText, height: 180 }}>
            <div className="max-w-custom" style={{ '--max-w-custom': '400px' }}>
                <h3 className="text-bold">{syncFoldersText}</h3>
                <p className="mt-2">
                    {c('Info')
                        .t`Sync folders with ease using our desktop app, ensuring your files are always up to date and accessible from anywhere.`}
                </p>
                <PrimaryButton
                    onClick={startDownload}
                    className="mt-8 mx-auto flex flex-item-grow-1 flex-align-items-center"
                    disabled={downloadDisabled}
                >
                    <Icon name="brand-windows" className="mr-2" />
                    {downloadText}
                </PrimaryButton>
            </div>
        </EmptyViewContainer>
    );
};

export default EmptyDevices;
