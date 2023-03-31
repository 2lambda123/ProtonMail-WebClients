import { type VFC, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { Form, type FormikContextType, FormikProvider, useFormik } from 'formik';
import { c } from 'ttag';
import uniqid from 'uniqid';

import { Button } from '@proton/atoms';
import { Icon } from '@proton/components';
import { type State, itemCreationIntent, selectAliasByAliasEmail } from '@proton/pass/store';
import { normalizeOtpUriFromUserInput } from '@proton/pass/utils/otp';
import { isEmptyString } from '@proton/pass/utils/string';
import { getEpoch } from '@proton/pass/utils/time';
import { omit } from '@proton/shared/lib/helpers/object';

import type { ItemEditProps } from '../../../../shared/items';
import { deriveAliasPrefixFromName } from '../../../../shared/items/alias';
import { FieldsetCluster } from '../../../components/Controls/FieldsetCluster';
import { DropdownMenuButton } from '../../../components/Dropdown/DropdownMenuButton';
import { QuickActionsDropdown } from '../../../components/Dropdown/QuickActionsDropdown';
import { Field } from '../../../components/Fields/Field';
import { PasswordFieldWIP } from '../../../components/Fields/PasswordField';
import { TextFieldWIP } from '../../../components/Fields/TextField';
import { TextAreaFieldWIP } from '../../../components/Fields/TextareaField';
import { TitleField } from '../../../components/Fields/TitleField';
import { UrlGroupFieldCluster, createNewUrl } from '../../../components/Fields/UrlGroupFieldCluster';
import { ItemEditPanel } from '../../../components/Panel/ItemEditPanel';
import { AliasModal } from '../Alias/Alias.modal';
import { type EditLoginItemFormValues, LoginItemFormValues, validateEditLoginForm } from './Login.validation';

const FORM_ID = 'edit-login';

export const LoginEdit: VFC<ItemEditProps<'login'>> = ({ vault, revision, onSubmit, onCancel }) => {
    const { shareId } = vault;
    const { data: item, itemId, revision: lastRevision } = revision;
    const {
        metadata: { name, note, itemUuid },
        content: { username, password, totpUri, urls },
        extraFields,
    } = item;

    const dispatch = useDispatch();
    const [aliasModalOpen, setAliasModalOpen] = useState(false);

    const relatedAlias = useSelector((state: State) => selectAliasByAliasEmail(state, username));

    const initialValues = {
        name,
        username,
        password,
        note,
        shareId,
        totpUri,
        url: '',
        urls: urls.map(createNewUrl),
        ...(!relatedAlias && {
            withAlias: false,
        }),
    };

    const form = useFormik<EditLoginItemFormValues>({
        initialValues,
        initialErrors: validateEditLoginForm(initialValues),
        onSubmit: ({ name, username, password, totpUri, url, urls, note, ...values }) => {
            const mutationTime = getEpoch();
            const withAlias =
                'withAlias' in values &&
                values.withAlias &&
                values.aliasSuffix !== undefined &&
                values.aliasPrefix !== undefined &&
                values.mailboxes.length > 0;

            const normalizedOtpUri = normalizeOtpUriFromUserInput(totpUri, {
                label: username || undefined,
                issuer: name || undefined,
            });

            if (withAlias) {
                const aliasOptimisticId = uniqid();

                dispatch(
                    itemCreationIntent({
                        type: 'alias',
                        optimisticId: aliasOptimisticId,
                        shareId,
                        createTime: mutationTime - 1 /* alias will be created before login in saga */,
                        metadata: {
                            name: `Alias for ${name}`,
                            note: '',
                            itemUuid: aliasOptimisticId,
                        },
                        content: {},
                        extraData: {
                            mailboxes: values.mailboxes,
                            prefix: values.aliasPrefix!,
                            signedSuffix: values.aliasSuffix!.signature,
                            aliasEmail: username,
                        },
                        extraFields: [],
                    })
                );
            }

            onSubmit({
                type: 'login',
                itemId,
                shareId,
                lastRevision,
                metadata: { name, note, itemUuid },
                content: {
                    username,
                    password,
                    urls: Array.from(new Set(urls.map(({ url }) => url).concat(isEmptyString(url) ? [] : [url]))),
                    totpUri: normalizedOtpUri,
                },
                extraFields,
            });
        },
        validate: validateEditLoginForm,
        validateOnChange: true,
    });

    const { values, touched, setFieldValue } = form;

    useEffect(() => {
        async function fillAutoGeneratedAlias() {
            if ('aliasPrefix' in touched && !touched.aliasPrefix && values.name) {
                try {
                    await setFieldValue('aliasPrefix', deriveAliasPrefixFromName(values.name), true);
                } catch (_) {}
            }
        }

        void fillAutoGeneratedAlias();
    }, [values.name, 'aliasPrefix' in touched && !touched.aliasPrefix, setFieldValue]);

    const valid = form.isValid;

    return (
        <>
            <ItemEditPanel type="login" formId={FORM_ID} valid={valid} handleCancelClick={onCancel}>
                <FormikProvider value={form}>
                    <Form id={FORM_ID}>
                        <FieldsetCluster>
                            <Field name="name" label={c('Label').t`Title`} component={TitleField} />
                        </FieldsetCluster>

                        <FieldsetCluster>
                            <Field
                                name="username"
                                label={c('Label').t`Username`}
                                placeholder={c('Placeholder').t`Enter email or username`}
                                component={TextFieldWIP}
                                itemType="login"
                                icon="user"
                                {...('withAlias' in form.values &&
                                    (form.values.withAlias
                                        ? {
                                              actions: (
                                                  <QuickActionsDropdown>
                                                      <DropdownMenuButton
                                                          className="flex flex-align-items-center text-left"
                                                          onClick={() => {
                                                              void form.setValues(
                                                                  (values) =>
                                                                      ({
                                                                          ...omit(values as LoginItemFormValues<true>, [
                                                                              'aliasPrefix',
                                                                              'aliasSuffix',
                                                                              'mailboxes',
                                                                          ]),
                                                                          withAlias: false,
                                                                          username: initialValues.username,
                                                                      } as LoginItemFormValues<false>)
                                                              );
                                                          }}
                                                      >
                                                          <Icon name="trash" className="mr0-5" />
                                                          {c('Action').t`Delete alias`}
                                                      </DropdownMenuButton>
                                                  </QuickActionsDropdown>
                                              ),
                                          }
                                        : {
                                              actions: (
                                                  <Button
                                                      icon
                                                      pill
                                                      color="weak"
                                                      shape="solid"
                                                      size="small"
                                                      className="pass-item-icon"
                                                      title={c('Action').t`Generate alias`}
                                                      onClick={async () => {
                                                          try {
                                                              await form.setValues(
                                                                  (values) =>
                                                                      ({
                                                                          ...values,
                                                                          withAlias: true,
                                                                          aliasPrefix: '',
                                                                          aliasSuffix: undefined,
                                                                          mailboxes: [],
                                                                      } as LoginItemFormValues<true>)
                                                              );
                                                              await form.setFieldTouched('aliasPrefix', false);
                                                          } catch (_) {}
                                                          setAliasModalOpen(true);
                                                      }}
                                                  >
                                                      <Icon name="alias" size={24} />
                                                  </Button>
                                              ),
                                          }))}
                            />

                            <Field
                                name="password"
                                label={c('Label').t`Password`}
                                component={PasswordFieldWIP}
                                icon="key"
                            />

                            <Field
                                name="totpUri"
                                label={c('Label').t`OTP`}
                                component={PasswordFieldWIP}
                                actions={null}
                                icon="lock"
                            />
                        </FieldsetCluster>

                        <UrlGroupFieldCluster form={form} />

                        <FieldsetCluster>
                            <Field
                                name="note"
                                label={c('Label').t`Note`}
                                placeholder={c('Placeholder').t`Enter a note ...`}
                                component={TextAreaFieldWIP}
                                icon="note"
                            />
                        </FieldsetCluster>
                    </Form>
                </FormikProvider>
            </ItemEditPanel>
            {aliasModalOpen && (
                <AliasModal<LoginItemFormValues<true>>
                    open={aliasModalOpen}
                    onClose={async () => {
                        try {
                            await form.setFieldTouched('aliasPrefix', undefined);
                            await form.setValues(
                                (values) =>
                                    ({
                                        ...omit(values as LoginItemFormValues<true>, [
                                            'aliasPrefix',
                                            'aliasSuffix',
                                            'mailboxes',
                                        ]),
                                        withAlias: false,
                                    } as LoginItemFormValues<false>)
                            );
                        } catch (_) {}
                        setAliasModalOpen(false);
                    }}
                    handleSubmitClick={async () => {
                        try {
                            await form.setFieldTouched('aliasPrefix', true);
                            await form.setValues((values) => {
                                const valuesWithAlias = values as LoginItemFormValues<true>;

                                return {
                                    ...values,
                                    username: valuesWithAlias.aliasPrefix! + valuesWithAlias.aliasSuffix!.value,
                                };
                            });
                        } catch (_) {}
                        setAliasModalOpen(false);
                    }}
                    form={form as FormikContextType<LoginItemFormValues<true>>}
                    shareId={shareId}
                />
            )}
        </>
    );
};
