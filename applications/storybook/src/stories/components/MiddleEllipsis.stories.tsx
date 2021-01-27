import React from 'react';
import { MiddleEllipsis } from 'react-components';

import mdx from './MiddleEllipsis.mdx';

export default {
    component: MiddleEllipsis,
    title: 'Components / Middle Ellipsis',
    parameters: {
        docs: {
            page: mdx,
        },
    },
};

const textToEllipsis = `mySuperLoooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooongFile.jpg`;

export const Basic = () => <MiddleEllipsis text={textToEllipsis} />;
export const Notitle = () => <MiddleEllipsis displayTitle={false} text={textToEllipsis} />;
