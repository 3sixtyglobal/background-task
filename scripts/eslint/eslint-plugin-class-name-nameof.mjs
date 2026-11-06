// Copyright 2026 3Sixty Trade Ltd.
// SPDX-License-Identifier: Apache-2.0.

/**
 * ESLint rule that requires CLASS_NAME to be set with nameof of its own class, not a string literal.
 */
const classNameNameofRule = {
	meta: {
		type: 'problem',
		docs: {
			description: 'Require CLASS_NAME to be set with nameof<ClassName>() of the enclosing class.'
		},
		schema: [],
		messages: {
			useNameof: 'Set CLASS_NAME with nameof<{{className}}>() of its own class.'
		}
	},
	create(context) {
		return {
			PropertyDefinition(node) {
				if (node.computed || node.key.type !== 'Identifier' || node.key.name !== 'CLASS_NAME') {
					return;
				}

				const className = node.parent.parent.id?.name;
				const value = node.value;
				const typeArgs = (value?.typeArguments ?? value?.typeParameters)?.params;
				const isNameof =
					value?.type === 'CallExpression' &&
					value.callee.type === 'Identifier' &&
					value.callee.name === 'nameof' &&
					value.arguments.length === 0 &&
					typeArgs?.length === 1 &&
					typeArgs[0].type === 'TSTypeReference' &&
					typeArgs[0].typeName.type === 'Identifier' &&
					(className === undefined || typeArgs[0].typeName.name === className);

				if (!isNameof) {
					context.report({
						node: value ?? node,
						messageId: 'useNameof',
						data: { className: className ?? 'ClassName' }
					});
				}
			}
		};
	}
};

/**
 * ESLint plugin exposing the class-name-nameof rule.
 */
export const classNameNameofPlugin = {
	rules: {
		'class-name-nameof': classNameNameofRule
	}
};
