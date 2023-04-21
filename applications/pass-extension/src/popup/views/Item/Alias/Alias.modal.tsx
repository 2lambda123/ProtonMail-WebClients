import { useEffect, useState } from 'react';

import { type FormikContextType, FormikProvider } from 'formik';
import { c } from 'ttag';

import { Button } from '@proton/atoms';
import { Icon, type ModalProps } from '@proton/components/components';

import { SidebarModal } from '../../../../shared/components/sidebarmodal/SidebarModal';
import { useAliasOptions } from '../../../../shared/hooks/useAliasOptions';
import { AliasPreview } from '../../../components/Alias/Alias.preview';
import { PanelHeader } from '../../../components/Panel/Header';
import { Panel } from '../../../components/Panel/Panel';
import { AliasForm } from './Alias.form';
import { type AliasFormValues, validateAliasForm } from './Alias.validation';

export type AliasModalRef = {
    open: () => void;
};

type AliasModalProps<T extends AliasFormValues> = {
    form: FormikContextType<T>;
    handleSubmitClick: () => void;
    shareId: string;
} & ModalProps;

export const AliasModal = <T extends AliasFormValues>({
    form,
    open,
    shareId,
    handleSubmitClick,
    ...modalProps
}: AliasModalProps<T>) => {
    const [ready, setReady] = useState(false);

    const { aliasOptions, aliasOptionsLoading } = useAliasOptions({ shareId });

    useEffect(() => {
        if (open && aliasOptions) {
            const firstSuffix = aliasOptions.suffixes?.[0];
            const firstMailBox = aliasOptions.mailboxes?.[0];

            form.setValues(
                (values) => ({
                    ...values,
                    ...(firstSuffix && { aliasSuffix: firstSuffix }),
                    ...(firstMailBox && { mailboxes: [firstMailBox] }),
                }),
                true
            );

            setReady(true);
        }
    }, [open, aliasOptions]);

    return (
        <SidebarModal {...modalProps} open={open}>
            <Panel
                className="ui-login"
                header={
                    <PanelHeader
                        className="mb-8"
                        actions={[
                            <Button
                                key="modal-close-button"
                                className="flex-item-noshrink"
                                icon
                                pill
                                shape="solid"
                                onClick={modalProps.onClose}
                            >
                                <Icon className="modal-close-icon" name="cross" alt={c('Action').t`Close`} />
                            </Button>,

                            <Button
                                className="text-sm"
                                key="modal-submit-button"
                                onClick={handleSubmitClick}
                                color="norm"
                                pill
                                disabled={!(ready && Object.keys(validateAliasForm(form.values)).length === 0)}
                            >
                                {c('Action').t`Confirm`}
                            </Button>,
                        ]}
                    />
                }
            >
                <FormikProvider value={form}>
                    <AliasPreview
                        prefix={form.values.aliasPrefix ?? '<prefix>'}
                        suffix={form.values.aliasSuffix?.value ?? '<suffix>'}
                        loading={aliasOptionsLoading}
                    />
                    <AliasForm<T> form={form} aliasOptions={aliasOptions} aliasOptionsLoading={aliasOptionsLoading} />
                </FormikProvider>
            </Panel>
        </SidebarModal>
    );
};