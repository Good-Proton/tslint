/**
 * @license
 * Copyright 2013 Palantir Technologies, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    isInterfaceDeclaration,
    isInterfaceType,
    isObjectLiteralExpression,
    isSameLine,
    isTypeAliasDeclaration,
    isTypeLiteralNode,
} from "tsutils";
import * as ts from "typescript";

import { showWarningOnce } from "../error";
import * as Lint from "../index";

import { codeExamples } from "./code-examples/objectLiteralSortKeys.examples";

const OPTION_IGNORE_BLANK_LINES = "ignore-blank-lines";
const OPTION_IGNORE_CASE = "ignore-case";
const OPTION_LOCALE_COMPARE = "locale-compare";
const OPTION_MATCH_DECLARATION_ORDER = "match-declaration-order";
const OPTION_MATCH_DECLARATION_ORDER_ONLY = "match-declaration-order-only";
const OPTION_SHORTHAND_FIRST = "shorthand-first";

interface Options {
    ignoreBlankLines: boolean;
    ignoreCase: boolean;
    localeCompare: boolean;
    matchDeclarationOrder: boolean;
    matchDeclarationOrderOnly: boolean;
    shorthandFirst: boolean;
}

export class Rule extends Lint.Rules.OptionallyTypedRule {
    /* tslint:disable:object-literal-sort-keys */
    public static metadata: Lint.IRuleMetadata = {
        ruleName: "object-literal-sort-keys",
        description: Lint.Utils.dedent`
            Checks ordering of keys in object literals.

            When using the default alphabetical ordering, additional blank lines may be used to group
            object properties together while keeping the elements within each group in alphabetical order.
            To opt out of this use ${OPTION_IGNORE_BLANK_LINES} option.
        `,
        rationale: "Useful in preventing merge conflicts",
        optionsDescription: Lint.Utils.dedent`
            By default, this rule checks that keys are in alphabetical order.
            The following may optionally be passed:

            * \`${OPTION_IGNORE_BLANK_LINES}\` will enforce alphabetical ordering regardless of blank lines between each key-value pair.
            * \`${OPTION_IGNORE_CASE}\` will compare keys in a case insensitive way.
            * \`${OPTION_LOCALE_COMPARE}\` will compare keys using the expected sort order of special characters, such as accents.
            * \`${OPTION_MATCH_DECLARATION_ORDER}\` will prefer to use the key ordering of the contextual type of the object literal, as in:

                \`\`\`
                interface I { foo: number; bar: number; }
                const obj: I = { foo: 1, bar: 2 };
                \`\`\`

            If a contextual type is not found, alphabetical ordering will be used instead.
            * "${OPTION_MATCH_DECLARATION_ORDER_ONLY}" exactly like "${OPTION_MATCH_DECLARATION_ORDER}",
                but don't fall back to alphabetical if a contextual type is not found.

                Note: If both ${OPTION_MATCH_DECLARATION_ORDER_ONLY} and ${OPTION_MATCH_DECLARATION_ORDER} options are present,
                      ${OPTION_MATCH_DECLARATION_ORDER_ONLY} will take precedence and alphabetical fallback will not occur.

            * \`${OPTION_SHORTHAND_FIRST}\` will enforce shorthand properties to appear first, as in:

                \`\`\`
                const obj = { a, c, b: true };
                \`\`\`
            `,
        options: {
            type: "string",
            enum: [
                OPTION_IGNORE_BLANK_LINES,
                OPTION_IGNORE_CASE,
                OPTION_LOCALE_COMPARE,
                OPTION_MATCH_DECLARATION_ORDER,
                OPTION_MATCH_DECLARATION_ORDER_ONLY,
                OPTION_SHORTHAND_FIRST,
            ],
        },
        optionExamples: [
            true,
            [
                true,
                OPTION_IGNORE_BLANK_LINES,
                OPTION_IGNORE_CASE,
                OPTION_LOCALE_COMPARE,
                OPTION_MATCH_DECLARATION_ORDER,
                OPTION_SHORTHAND_FIRST,
            ],
        ],
        type: "maintainability",
        typescriptOnly: false,
        codeExamples,
    };
    /* tslint:enable:object-literal-sort-keys */

    public static FAILURE_STRING_ALPHABETICAL(name: string): string {
        return `The key '${name}' is not sorted alphabetically`;
    }

    public static FAILURE_STRING_USE_DECLARATION_ORDER(
        propName: string,
        typeName: string | undefined,
    ): string {
        const type = typeName === undefined ? "its type declaration" : `'${typeName}'`;
        return `The key '${propName}' is not in the same order as it is in ${type}.`;
    }

    public static FAILURE_STRING_SHORTHAND_FIRST(name: string): string {
        return `The shorthand property '${name}' should appear before normal properties`;
    }

    public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
        const options = parseOptions(this.ruleArguments);
        if (options.matchDeclarationOrder || options.matchDeclarationOrderOnly) {
            showWarningOnce(
                Lint.Utils.dedent`
                    ${this.ruleName} needs type info to use "${OPTION_MATCH_DECLARATION_ORDER}" or
                    "${OPTION_MATCH_DECLARATION_ORDER_ONLY}".
                    See https://palantir.github.io/tslint/usage/type-checking/ for documentation on
                    how to enable this feature.
                `,
            );
            return [];
        }

        return this.applyWithFunction(sourceFile, walk, options);
    }

    public applyWithProgram(sourceFile: ts.SourceFile, program: ts.Program): Lint.RuleFailure[] {
        const options = parseOptions(this.ruleArguments);
        if (options.matchDeclarationOrder && options.matchDeclarationOrderOnly) {
            showWarningOnce(
                `"${OPTION_MATCH_DECLARATION_ORDER}" will be ignored since ` +
                `"${OPTION_MATCH_DECLARATION_ORDER_ONLY}" has been enabled for ${this.ruleName
                }.`,
            );
            return [];
        }

        return this.applyWithFunction(
            sourceFile,
            walk,
            parseOptions(this.ruleArguments),
            program.getTypeChecker(),
        );
    }
}

function parseOptions(ruleArguments: any[]): Options {
    return {
        ignoreBlankLines: has(OPTION_IGNORE_BLANK_LINES),
        ignoreCase: has(OPTION_IGNORE_CASE),
        localeCompare: has(OPTION_LOCALE_COMPARE),
        matchDeclarationOrder: has(OPTION_MATCH_DECLARATION_ORDER),
        matchDeclarationOrderOnly: has(OPTION_MATCH_DECLARATION_ORDER_ONLY),
        shorthandFirst: has(OPTION_SHORTHAND_FIRST),
    };

    function has(name: string) {
        return ruleArguments.indexOf(name) !== -1;
    }
}

function walk(ctx: Lint.WalkContext<Options>, checker?: ts.TypeChecker): void {
    const {
        sourceFile,
        options: {
            ignoreBlankLines,
            ignoreCase,
            localeCompare,
            matchDeclarationOrder,
            matchDeclarationOrderOnly,
            shorthandFirst,
        },
    } = ctx;

    ts.forEachChild(sourceFile, function cb(node): void {
        if (isObjectLiteralExpression(node) && node.properties.length > 1) {
            check(node);
        }
        ts.forEachChild(node, cb);
    });

    function check(node: ts.ObjectLiteralExpression): void {
        if (matchDeclarationOrder || matchDeclarationOrderOnly) {
            const type = getContextualType(node, checker!);
            // If type has an index signature, we can't check ordering.
            // If type has call/construct signatures, it can't be satisfied by an object literal anyway.
            if (type !== undefined) {
                const members = type.members as ReadonlyArray<{ kind: ts.SyntaxKind, name: ts.PropertyName }>;
                const typeName = getDeclarationName(type);
                const groups = [{
                    name: getDeclarationName(type),
                    props: members
                }];
                const knownPropNames = new Map<string, string | undefined>(
                    members
                        .filter(m => m.name && m.name.kind !== ts.SyntaxKind.ComputedPropertyName)
                        .map(m => [(m.name as ts.Identifier).text, typeName])
                );
                const contexualType = checker!.getContextualType(node)!;
                if (isInterfaceType(contexualType)) {
                    const baseTypes = checker!.getBaseTypes(contexualType);

                    for (const baseType of baseTypes) {
                        const properties = baseType.getProperties();
                        const baseTypeName = getTypeName(baseType);
                        const ms: Array<{ kind: ts.SyntaxKind, name: ts.PropertyName }> = []
                        for (const { declarations } of properties) {
                            if (declarations === undefined || declarations.length !== 1) {
                                continue;
                            }

                            const declaration = declarations[0];
                            if (!ts.isTypeElement(declaration)) {
                                continue;
                            }

                            const name = declaration.name;
                            if (!name || name.kind === ts.SyntaxKind.ComputedPropertyName) {
                                continue;
                            }
                            if (!knownPropNames.has(name.text)) {
                                ms.push({
                                    kind: declaration.kind,
                                    name: declaration.name!
                                });
                                knownPropNames.set(name.text, baseTypeName);
                            }
                        }
                        if (ms.length) {
                            groups.push({
                                name: baseTypeName,
                                props: ms
                            });
                        }
                    }
                }
                if (groups.every(g => g.props.every(
                    m =>
                        m.kind === ts.SyntaxKind.PropertySignature ||
                        m.kind === ts.SyntaxKind.MethodSignature,
                ))
                ) {
                    checkMatchesDeclarationOrder(node, groups, knownPropNames);
                    return;
                }
            }
        }
        if (!matchDeclarationOrderOnly) {
            checkAlphabetical(node);
        }
    }

    function checkAlphabetical(node: ts.ObjectLiteralExpression): void {
        if (isSameLine(ctx.sourceFile, node.properties.pos, node.end)) {
            return;
        }

        let lastKey: string | undefined;
        let lastPropertyWasShorthand: boolean | undefined;
        for (const property of node.properties) {
            switch (property.kind) {
                case ts.SyntaxKind.SpreadAssignment:
                    lastKey = undefined; // reset at spread
                    lastPropertyWasShorthand = undefined; // reset at spread
                    break;
                case ts.SyntaxKind.ShorthandPropertyAssignment:
                case ts.SyntaxKind.PropertyAssignment:
                    if (shorthandFirst) {
                        if (property.kind === ts.SyntaxKind.ShorthandPropertyAssignment) {
                            if (lastPropertyWasShorthand === false) {
                                ctx.addFailureAtNode(
                                    property.name,
                                    Rule.FAILURE_STRING_SHORTHAND_FIRST(property.name.text),
                                );
                                return; // only show warning on first out-of-order property
                            }

                            lastPropertyWasShorthand = true;
                        } else {
                            if (lastPropertyWasShorthand === true) {
                                lastKey = undefined; // reset on change from shorthand to normal
                            }

                            lastPropertyWasShorthand = false;
                        }
                    }

                    if (
                        property.name.kind === ts.SyntaxKind.Identifier ||
                        property.name.kind === ts.SyntaxKind.StringLiteral
                    ) {
                        const key = ignoreCase
                            ? property.name.text.toLowerCase()
                            : property.name.text;
                        // comparison with undefined is expected
                        const keyOrderDescending =
                            lastKey === undefined
                                ? false
                                : localeCompare
                                    ? lastKey.localeCompare(key) === 1
                                    : lastKey > key;

                        if (keyOrderDescending && ignoreBlankLines) {
                            ctx.addFailureAtNode(
                                property.name,
                                Rule.FAILURE_STRING_ALPHABETICAL(property.name.text),
                            );
                            return;
                        }
                        if (keyOrderDescending && !hasBlankLineBefore(ctx.sourceFile, property)) {
                            ctx.addFailureAtNode(
                                property.name,
                                Rule.FAILURE_STRING_ALPHABETICAL(property.name.text),
                            );
                            return; // only show warning on first out-of-order property
                        }
                        lastKey = key;
                    }
            }
        }
    }

    function checkMatchesDeclarationOrder(
        { properties }: ts.ObjectLiteralExpression,
        groups: ReadonlyArray<{
            name: string | undefined
            props: ReadonlyArray<{ name: ts.PropertyName }>
        }>,
        knownPropNames: Map<string, string | undefined>
    ): void {
        function check(members: ReadonlyArray<{ name: ts.PropertyName }>) {
            let memberIndex = 0;
            outer: for (const prop of properties) {
                if (prop.kind === ts.SyntaxKind.SpreadAssignment) {
                    memberIndex = 0;
                    continue;
                }

                if (prop.name.kind === ts.SyntaxKind.ComputedPropertyName) {
                    continue;
                }

                const propName = prop.name.text;
                if (!knownPropNames.has(propName)) {
                    // ignore unknown props (from unions or intersections)
                    continue;
                }

                for (; memberIndex !== members.length; memberIndex++) {
                    const { name: memberName } = members[memberIndex];
                    if (
                        memberName.kind !== ts.SyntaxKind.ComputedPropertyName &&
                        propName === (memberName && memberName.text)
                    ) {
                        continue outer;
                    }
                }

                // This We didn't find the member we were looking for past the previous member,
                // so it must have come before it and is therefore out of order.
                return {
                    name: prop.name,
                    propName: prop.name.text
                };
            }

            return false;
        }

        let fail = check(groups.reduceRight( // from base to derived
            (members, group) => members.concat(group.props),
            [] as Array<{ name: ts.PropertyName }>
        ));

        if (!fail) {
            return;
        }

        fail = check(groups.reduce( // from derived to base
            (members, group) => members.concat(group.props),
            [] as Array<{ name: ts.PropertyName }>
        ));

        if (!fail) {
            return;
        }

        ctx.addFailureAtNode(
            fail.name,
            Rule.FAILURE_STRING_USE_DECLARATION_ORDER(fail.propName, knownPropNames.get(fail.propName)),
        );
    }
}

function hasBlankLineBefore(sourceFile: ts.SourceFile, element: ts.ObjectLiteralElement) {
    let comments = ts.getLeadingCommentRanges(sourceFile.text, element.pos);

    if (comments === undefined) {
        comments = []; // it will be easier to work with an empty array down below...
    }

    const elementStart =
        comments.length > 0 ? comments[comments.length - 1].end : element.getFullStart();

    // either the element itself, or one of its leading comments must have an extra new line before them
    return (
        hasDoubleNewLine(sourceFile, elementStart) ||
        comments.some(comment => {
            const commentLine = ts.getLineAndCharacterOfPosition(sourceFile, comment.pos).line;
            const commentLineStartPosition = ts.getPositionOfLineAndCharacter(
                sourceFile,
                commentLine,
                0,
            );

            return hasDoubleNewLine(sourceFile, commentLineStartPosition - 4);
        })
    );
}

function hasDoubleNewLine(sourceFile: ts.SourceFile, position: number) {
    return /(\r?\n){2}/.test(sourceFile.text.slice(position, position + 4));
}

function getDeclarationName(t: ts.Node): string | undefined {
    const parent = t.parent;
    return isInterfaceDeclaration(t)
        ? t.name.text
        : isTypeAliasDeclaration(parent)
            ? parent.name.text
            : undefined;
}

function getTypeName(t: ts.Type): string | undefined {
    const symbol = t.symbol;
    const declarations = symbol.declarations;
    if (declarations && declarations.length === 1) {
        const declaration = declarations[0];
        return getDeclarationName(declaration);
    }
    return undefined;
}

type TypeLike = ts.InterfaceDeclaration | ts.TypeLiteralNode;

function getContextualType(node: ts.Expression, checker: ts.TypeChecker): TypeLike | undefined {
    const c = checker.getContextualType(node);
    if (c === undefined || c.symbol === undefined) {
        return undefined;
    }

    const { declarations } = c.symbol;
    if (declarations === undefined || declarations.length !== 1) {
        return undefined;
    }

    const decl = declarations[0];
    return isInterfaceDeclaration(decl) || isTypeLiteralNode(decl) ? decl : undefined;
}
