import React, { ReactNode } from 'react';
import { HighlightMetadata } from '../../models/encryptedSearch';

/**
 * Traverse an email's body to highlight only text within HTML tags
 */
const recursiveBodyTraversal = (node: Node, applySearch: (text: string) => HTMLSpanElement | undefined) => {
    if (node.nodeName === 'STYLE') {
        return;
    }
    if (node.nodeName === '#text') {
        if (node.textContent) {
            const highlightedSpan = applySearch(node.textContent);
            if (highlightedSpan) {
                node.parentNode?.replaceChild(highlightedSpan, node);
            }
        }
        return;
    }
    for (const child of node.childNodes) {
        recursiveBodyTraversal(child, applySearch);
    }
};

/**
 * Removes overlapping intervals to highlight
 */
export const sanitisePositions = (positions: [number, number][]) => {
    if (positions.length < 2) {
        return positions;
    }

    positions.sort((position1, position2) => position1[0] - position2[0]);

    const result = [];
    let previousValue = positions[0];
    for (let i = 1; i < positions.length; i += 1) {
        if (previousValue[1] >= positions[i][0]) {
            previousValue = [previousValue[0], Math.max(previousValue[1], positions[i][1])];
        } else {
            result.push(previousValue);
            previousValue = positions[i];
        }
    }
    result.push(previousValue);

    return result;
};

/**
 * Find occurrences of a keyword in a text
 */
export const findOccurrences = (text: string, normalisedKeywords: string[]) => {
    const positions: [number, number][] = [];
    const searchString = text.toLocaleLowerCase();
    for (const keyword of normalisedKeywords) {
        let finder = 0;
        let startFrom = 0;
        while (finder !== -1) {
            finder = searchString.indexOf(keyword, startFrom);
            if (finder !== -1) {
                positions.push([finder, finder + keyword.length]);
                startFrom = finder + keyword.length;
            }
        }
    }

    return sanitisePositions(positions);
};

/**
 * Insert the highlighting HTML tags inside the body of an email
 */
export const insertMarks = (content: string, normalisedKeywords: string[], setAutoScroll: boolean) => {
    const domParser = new DOMParser();
    const html = domParser.parseFromString(content, 'text/html');

    const applySearch = (text: string) => {
        const sanitisedPositions = findOccurrences(text, normalisedKeywords);
        if (!sanitisedPositions.length) {
            return;
        }

        const span = html.createElement('span');

        let previousIndex = 0;
        for (const position of sanitisedPositions) {
            const oldPreviousIndex = previousIndex;
            [, previousIndex] = position;
            span.appendChild(html.createTextNode(text.slice(oldPreviousIndex, position[0])));
            const mark = html.createElement('mark');
            const markedText = html.createTextNode(text.slice(position[0], position[1]));
            mark.appendChild(markedText);
            span.appendChild(mark);
        }
        span.appendChild(html.createTextNode(text.slice(sanitisedPositions[sanitisedPositions.length - 1][1])));

        return span;
    };

    recursiveBodyTraversal(html.body, applySearch);

    if (setAutoScroll) {
        const marks = html.body.getElementsByTagName('mark');
        marks.item(0)?.setAttribute('data-auto-scroll', 'true');
    }

    return html.documentElement.outerHTML;
};

/**
 * Creates an element containing the highlighted email subject
 */
export const highlightJSX = (subject: string, normalisedKeywords: string[]) => {
    const sanitisedPositions = findOccurrences(subject, normalisedKeywords);

    if (sanitisedPositions.length) {
        let previousIndex = 0;
        return (
            <span>
                {sanitisedPositions.map((position, index) => {
                    const oldPreviousIndex = previousIndex;
                    [, previousIndex] = position;
                    return (
                        <span
                            key={index} // eslint-disable-line react/no-array-index-key
                        >
                            {subject.slice(oldPreviousIndex, position[0])}
                            <mark>{subject.slice(position[0], position[1])}</mark>
                        </span>
                    );
                })}
                {subject.slice(sanitisedPositions[sanitisedPositions.length - 1][1])}
            </span>
        );
    }

    return <span>{subject}</span>;
};

/**
 * Insert highlighting markers only if a ReactNode is a string or can be parsed as such
 */
export const highlightNode = (node: ReactNode, highlightMetadata: HighlightMetadata) => {
    const nodeValue = node?.valueOf();
    if (typeof nodeValue === 'string') {
        return highlightMetadata(nodeValue);
    }
    if (
        !!nodeValue &&
        Object.prototype.isPrototypeOf.call(Object.prototype, nodeValue) &&
        Object.prototype.hasOwnProperty.call(nodeValue, 'props')
    ) {
        const { props } = nodeValue as { props: any };
        if (
            Object.prototype.isPrototypeOf.call(Object.prototype, props) &&
            Object.prototype.hasOwnProperty.call(props, 'children')
        ) {
            const { children } = props;
            if (Array.isArray(props.children) && children.every((child: any) => typeof child === 'string')) {
                return highlightMetadata(children.join(''));
            }
        }
    }
    return node;
};
