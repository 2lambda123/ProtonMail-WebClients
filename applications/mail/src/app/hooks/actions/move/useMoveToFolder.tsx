import { Dispatch, SetStateAction } from 'react';

import { useGetLabels } from '@proton/components/hooks/useCategories';
import { MAILBOX_LABEL_IDS } from '@proton/shared/lib/constants';
import { Message } from '@proton/shared/lib/interfaces/mail/Message';

import { useMoveAllToFolder } from 'proton-mail/hooks/actions/move/useMoveAllToFolder';
import { useMoveSelectionToFolder } from 'proton-mail/hooks/actions/move/useMoveSelectionToFolder';

import { isMessage as testIsMessage } from '../../../helpers/elements';
import { isCustomLabel } from '../../../helpers/labels';
import { getMessagesAuthorizedToMove } from '../../../helpers/message/messages';
import { Element } from '../../../models/element';

const { INBOX } = MAILBOX_LABEL_IDS;

export interface MoveParams {
    elements: Element[];
    folderID: string;
    folderName: string;
    fromLabelID: string;
    createFilters?: boolean;
    silent?: boolean;
    askUnsub?: boolean;
    selectAll?: boolean;
    onCheckAll?: (check: boolean) => void;
}

export const useMoveToFolder = (setContainFocus?: Dispatch<SetStateAction<boolean>>) => {
    const getLabels = useGetLabels();
    const { moveSelectionToFolder, moveToSpamModal, moveSnoozedModal, moveScheduledModal, moveAllModal } =
        useMoveSelectionToFolder(setContainFocus);
    const { moveAllToFolder, selectAllMoveModal } = useMoveAllToFolder(setContainFocus);

    const moveToFolder = async ({
        elements,
        folderID,
        folderName,
        fromLabelID,
        createFilters = false,
        silent = false,
        askUnsub = true,
        selectAll,
        onCheckAll,
    }: MoveParams) => {
        if (!elements.length) {
            return;
        }

        const labels = (await getLabels()) || [];

        const isMessage = testIsMessage(elements[0]);
        const destinationLabelID = isCustomLabel(fromLabelID, labels) ? INBOX : fromLabelID;

        const authorizedToMove = isMessage ? getMessagesAuthorizedToMove(elements as Message[], folderID) : elements;

        if (selectAll) {
            await moveAllToFolder({
                fromLabelID,
                authorizedToMove,
                folderID,
                destinationLabelID,
                isMessage,
                onCheckAll,
            });
        } else {
            await moveSelectionToFolder({
                elements,
                folderID,
                folderName,
                fromLabelID,
                createFilters,
                silent,
                askUnsub,
                isMessage,
                destinationLabelID,
                authorizedToMove,
            });
        }
    };

    return { moveToFolder, moveScheduledModal, moveSnoozedModal, moveAllModal, moveToSpamModal, selectAllMoveModal };
};
