import type { VFC } from 'react';

import { RadioButtonGroupControl, type Props as RadioGroupControlProps } from '../Controls/RadioButtonGroupControl';
import { AbstractField, type AbstractFieldProps } from './AbstractField';

export const RadioButtonGroupFieldWIP: VFC<AbstractFieldProps<RadioGroupControlProps>> = (props) => {
    return (
        <AbstractField<RadioGroupControlProps> {...props}>
            {(inputControlProps) => (
                <RadioButtonGroupControl
                    {...inputControlProps}
                    onValue={(value: unknown) => {
                        inputControlProps.onValue?.(value);
                        props.form.setFieldValue(props.field.name, value);
                    }}
                >
                    {props.children}
                </RadioButtonGroupControl>
            )}
        </AbstractField>
    );
};