import { MESSAGE_FLAGS } from '@proton/shared/lib/mail/constants';
import { getAttachments, hasFlag } from '@proton/shared/lib/mail/messages';
import { MutableRefObject, useRef } from 'react';
import { c } from 'ttag';
import { isToday, isYesterday } from 'date-fns';
import {
    Button,
    classnames,
    Tooltip,
    Icon,
    EllipsisLoader,
    useMailSettings,
    useFeature,
    FeatureCode,
    useUser,
    Spotlight,
    Href,
    useSpotlightOnFeature,
} from '@proton/components';
import { metaKey, shiftKey, altKey } from '@proton/shared/lib/helpers/browser';
import DropdownMenuButton from '@proton/components/components/dropdown/DropdownMenuButton';
import { formatSimpleDate } from '../../helpers/date';
import { MessageExtended } from '../../models/message';
import AttachmentsButton from '../attachment/AttachmentsButton';
import SendActions from './SendActions';

interface Props {
    className?: string;
    message: MessageExtended;
    date: Date;
    lock: boolean;
    opening: boolean;
    syncInProgress: boolean;
    onAddAttachments: (files: File[]) => void;
    onPassword: () => void;
    onExpiration: () => void;
    onScheduleSendModal: () => void;
    onSend: () => Promise<void>;
    onDelete: () => Promise<void>;
    addressesBlurRef: MutableRefObject<() => void>;
    attachmentTriggerRef: MutableRefObject<() => void>;
    loadingScheduleCount: boolean;
}

const ComposerActions = ({
    className,
    message,
    date,
    lock,
    opening,
    syncInProgress,
    onAddAttachments,
    onPassword,
    onExpiration,
    onScheduleSendModal,
    onSend,
    onDelete,
    addressesBlurRef,
    attachmentTriggerRef,
    loadingScheduleCount,
}: Props) => {
    const isAttachments = getAttachments(message.data).length > 0;
    const isPassword = hasFlag(MESSAGE_FLAGS.FLAG_INTERNAL)(message.data) && message.data?.Password;
    const isExpiration = !!message.expiresIn;
    const sendDisabled = lock;
    const [{ Shortcuts = 0 } = {}] = useMailSettings();
    const [{ hasPaidMail }] = useUser();

    let dateMessage: string | string[];
    if (opening) {
        const ellipsis = <EllipsisLoader key="ellipsis1" />;
        dateMessage = c('Action').jt`Loading${ellipsis}`;
    } else if (syncInProgress) {
        const ellipsis = <EllipsisLoader key="ellipsis2" />;
        dateMessage = c('Action').jt`Saving${ellipsis}`;
    } else if (date.getTime() !== 0) {
        const dateString = formatSimpleDate(date);
        if (isToday(date)) {
            dateMessage = c('Info').t`Saved at ${dateString}`;
        } else if (isYesterday(date)) {
            dateMessage = c('Info').t`Saved ${dateString}`;
        } else {
            dateMessage = c('Info').t`Saved on ${dateString}`;
        }
    } else {
        dateMessage = c('Action').t`Not saved`;
    }

    const titleAttachment = Shortcuts ? (
        <>
            {c('Title').t`Attachments`}
            <br />
            <kbd className="no-border">{metaKey}</kbd> + <kbd className="no-border">{shiftKey}</kbd> +{' '}
            <kbd className="no-border">A</kbd>
        </>
    ) : (
        c('Title').t`Attachments`
    );
    const titleExpiration = Shortcuts ? (
        <>
            {c('Title').t`Expiration time`}
            <br />
            <kbd className="no-border">{metaKey}</kbd> + <kbd className="no-border">{shiftKey}</kbd> +{' '}
            <kbd className="no-border">X</kbd>
        </>
    ) : (
        c('Title').t`Expiration time`
    );
    const titleEncryption = Shortcuts ? (
        <>
            {c('Title').t`Encryption`}
            <br />
            <kbd className="no-border">{metaKey}</kbd> + <kbd className="no-border">{shiftKey}</kbd> +{' '}
            <kbd className="no-border">E</kbd>
        </>
    ) : (
        c('Title').t`Encryption`
    );
    const titleDeleteDraft = Shortcuts ? (
        <>
            {c('Title').t`Delete draft`}
            <br />
            <kbd className="no-border">{metaKey}</kbd> + <kbd className="no-border">{altKey}</kbd> +{' '}
            <kbd className="no-border">Backspace</kbd>
        </>
    ) : (
        c('Title').t`Delete draft`
    );
    const titleSendButton = Shortcuts ? (
        <>
            {c('Title').t`Send email`}
            <br />
            <kbd className="no-border">{metaKey}</kbd> + <kbd className="no-border">Enter</kbd>
        </>
    ) : null;

    const { feature, loading: loadingFeature } = useFeature(FeatureCode.ScheduledSend);
    const hasScheduleSendAccess = !loadingFeature && feature?.Value && hasPaidMail;

    const dropdownRef = useRef(null);
    const {
        show: showSpotlight,
        onDisplayed,
        onClose: onCloseSpotlight,
    } = useSpotlightOnFeature(FeatureCode.SpotlightScheduledSend, !opening && hasScheduleSendAccess);

    const handleScheduleSend = () => {
        onCloseSpotlight();
        onScheduleSendModal();
    };

    return (
        <footer
            data-testid="composer:footer"
            className={classnames([
                'composer-actions flex-item-noshrink flex flex-row-reverse flex-align-self-center w100 pl1 pr1 mb0-5',
                className,
            ])}
            onClick={addressesBlurRef.current}
        >
            <Spotlight
                originalPlacement="top-right"
                show={showSpotlight}
                onDisplayed={onDisplayed}
                anchorRef={dropdownRef}
                content={
                    <>
                        {c('Spotlight').t`You can now schedule your messages to be sent later`}
                        <br />
                        <Href
                            url="https://protonmail.com/support/knowledge-base/scheduled-send/"
                            title="Scheduled send"
                        >
                            {c('Info').t`Learn more`}
                        </Href>
                    </>
                }
            >
                <SendActions
                    disabled={loadingFeature || loadingScheduleCount}
                    loading={loadingFeature || loadingScheduleCount}
                    shape="solid"
                    color="norm"
                    mainAction={
                        <Tooltip title={titleSendButton}>
                            <Button
                                loading={loadingFeature}
                                onClick={onSend}
                                disabled={sendDisabled}
                                className="composer-send-button"
                                data-testid="composer:send-button"
                            >
                                <Icon name="paper-plane" className="no-desktop no-tablet on-mobile-flex" />
                                <span className="pl1 pr1 no-mobile">{c('Action').t`Send`}</span>
                            </Button>
                        </Tooltip>
                    }
                    secondAction={
                        hasScheduleSendAccess ? (
                            <Tooltip>
                                <DropdownMenuButton
                                    className="text-left"
                                    onClick={handleScheduleSend}
                                    data-testid="composer:schedule-send-button"
                                >
                                    <Icon name="clock" />
                                    <span className="pl1 pr1">{c('Action').t`Schedule send`}</span>
                                </DropdownMenuButton>
                            </Tooltip>
                        ) : undefined
                    }
                    dropdownRef={dropdownRef}
                />
            </Spotlight>
            <div className="flex flex-item-fluid">
                <div className="flex">
                    <Tooltip title={titleAttachment}>
                        <AttachmentsButton
                            isAttachments={isAttachments}
                            disabled={lock}
                            onAddAttachments={onAddAttachments}
                            attachmentTriggerRef={attachmentTriggerRef}
                            data-testid="composer:attachment-button"
                        />
                    </Tooltip>
                    <Tooltip title={titleExpiration}>
                        <Button
                            icon
                            color={isExpiration ? 'norm' : undefined}
                            shape="outline"
                            onClick={onExpiration}
                            disabled={lock}
                            className="ml0-5"
                            data-testid="composer:expiration-button"
                        >
                            <Icon name="hourglass-empty" alt={c('Action').t`Expiration time`} />
                        </Button>
                    </Tooltip>
                    <Tooltip title={titleEncryption}>
                        <Button
                            icon
                            color={isPassword ? 'norm' : undefined}
                            shape="outline"
                            data-testid="composer:password-button"
                            onClick={onPassword}
                            disabled={lock}
                            className="ml0-5"
                        >
                            <Icon name="lock" alt={c('Action').t`Encryption`} />
                        </Button>
                    </Tooltip>
                </div>
                <div className="flex mlauto">
                    <span className="mr0-5 mtauto mbauto no-mobile">{dateMessage}</span>
                    <Tooltip title={titleDeleteDraft}>
                        <Button
                            icon
                            disabled={lock}
                            onClick={onDelete}
                            shape="outline"
                            className="mr0-5"
                            data-testid="composer:delete-draft-button"
                        >
                            <Icon name="trash" alt={c('Action').t`Delete draft`} />
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </footer>
    );
};

export default ComposerActions;
