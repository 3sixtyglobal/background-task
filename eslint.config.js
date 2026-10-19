// Copyright 2024 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
/* eslint-disable import/namespace */
/* eslint-disable import/default */
/* eslint-disable import/no-named-as-default */
/* eslint-disable import/no-named-as-default-member */
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import headerPlugin from '@tony.ganchev/eslint-plugin-header';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import-x';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import promisePlugin from 'eslint-plugin-promise';
import simpleImportSortPlugin from 'eslint-plugin-simple-import-sort';
import unicornPlugin from 'eslint-plugin-unicorn';
import unusedImportsPlugin from 'eslint-plugin-unused-imports';
import globals from 'globals';
import { fileExists } from './scripts/common.mjs';
import { customLintPlugin } from './scripts/eslint/index.mjs';

let customModule;
if (await fileExists('./eslint.config-custom.js')) {
	customModule = await import('./eslint.config-custom.js');
}

const isCI = process.env.CI === 'true';

headerPlugin.rules.header.meta.schema = false;

const jsRules = {
	'accessor-pairs': 'error',
	'array-bracket-spacing': 'error',
	'arrow-body-style': 'error',
	'arrow-parens': ['error', 'as-needed'],
	'arrow-spacing': 'error',
	'block-scoped-var': 'error',
	'block-spacing': 'error',
	camelcase: 'error',
	'comma-dangle': ['error', 'never'],
	'comma-style': 'error',
	'computed-property-spacing': 'error',
	'consistent-this': 'error',
	curly: 'error',
	'dot-location': ['error', 'property'],
	'eol-last': 'error',
	eqeqeq: 'error',
	'for-direction': 'error',
	'func-name-matching': 'error',
	'func-names': 'error',
	'func-style': ['error', 'declaration', { allowArrowFunctions: true }],
	'generator-star-spacing': 'error',
	'grouped-accessor-pairs': 'error',
	'id-blacklist': 'error',
	'id-match': 'error',
	'jsx-quotes': 'error',
	'key-spacing': 'error',
	'linebreak-style': 'error',
	'max-classes-per-file': 'error',
	'max-len': [
		'error',
		{
			ignorePattern: '^import',
			ignoreTemplateLiterals: true,
			ignoreStrings: true,
			ignoreComments: true,
			ignoreRegExpLiterals: true,
			code: 120
		}
	],
	'max-nested-callbacks': 'error',
	'max-statements-per-line': 'error',
	'new-parens': 'error',
	'no-alert': 'error',
	'no-async-promise-executor': 'error',
	'no-bitwise': 'error',
	'no-caller': 'error',
	'no-case-declarations': 'error',
	'no-class-assign': 'error',
	'no-compare-neg-zero': 'error',
	'no-cond-assign': 'error',
	'no-confusing-arrow': 'error',
	'no-console': 'error',
	'no-constant-binary-expression': 'error',
	'no-constant-condition': 'error',
	'no-constructor-return': 'error',
	'no-continue': 'error',
	'no-control-regex': 'off',
	'no-debugger': 'error',
	'no-delete-var': 'error',
	'no-dupe-else-if': 'error',
	'no-else-return': 'error',
	'no-empty': 'off',
	'no-empty-character-class': 'error',
	'no-empty-pattern': 'error',
	'no-eq-null': 'error',
	'no-eval': 'error',
	'no-ex-assign': 'error',
	'no-extend-native': 'error',
	'no-extra-bind': 'error',
	'no-extra-boolean-cast': 'error',
	'no-extra-label': 'error',
	'no-fallthrough': 'error',
	'no-floating-decimal': 'error',
	'no-global-assign': 'error',
	'no-implicit-coercion': 'error',
	'no-implicit-globals': 'error',
	'no-implied-eval': 'error',
	'no-inner-declarations': 'error',
	'no-invalid-regexp': 'error',
	'no-irregular-whitespace': 'error',
	'no-iterator': 'error',
	'no-label-var': 'error',
	'no-labels': 'error',
	'no-lone-blocks': 'error',
	'no-lonely-if': 'error',
	'no-misleading-character-class': 'error',
	'no-mixed-operators': 'error',
	'no-multi-assign': 'error',
	'no-multi-spaces': 'error',
	'no-multi-str': 'error',
	'no-multiple-empty-lines': 'error',
	'no-new': 'error',
	'no-new-func': 'error',
	'no-new-object': 'error',
	'no-new-wrappers': 'error',
	'no-octal': 'error',
	'no-octal-escape': 'error',
	'no-proto': 'error',
	'no-prototype-builtins': 'error',
	'no-regex-spaces': 'error',
	'no-restricted-globals': 'error',
	'no-restricted-imports': [
		'error',
		{
			patterns: [
				{
					group: [
						'@3sixty/**/index.js',
						'./index.js',
						'./**/index.js',
						'../index.js',
						'../**/index.js',
						'!../dist/es/index.js',
						'!**/dist/es/index.js'
					],
					message: 'Import from a concrete module file instead of a barrel file.'
				}
			]
		}
	],
	'no-restricted-properties': 'error',
	'no-return-assign': 'error',
	'no-script-url': 'error',
	'no-self-assign': 'error',
	'no-self-compare': 'error',
	'no-sequences': 'error',
	'no-shadow': 'error',
	'no-shadow-restricted-names': 'error',
	'no-sparse-arrays': 'error',
	'no-template-curly-in-string': 'error',
	'no-throw-literal': 'off',
	'no-trailing-spaces': 'error',
	'no-undef-init': 'error',
	'no-unexpected-multiline': 'error',
	'no-unmodified-loop-condition': 'error',
	'no-unneeded-ternary': 'error',
	'no-unsafe-finally': 'error',
	'no-unused-labels': 'error',
	'no-unused-vars': ['error', { args: 'none' }],
	'no-useless-call': 'error',
	'no-useless-catch': 'error',
	'no-useless-computed-key': 'error',
	'no-useless-concat': 'error',
	'no-useless-escape': 'error',
	'no-useless-rename': 'error',
	'no-useless-return': 'error',
	'no-var': 'error',
	'no-void': 'error',
	'no-whitespace-before-property': 'error',
	'no-with': 'error',
	'nonblock-statement-body-position': 'error',
	'object-curly-newline': 'error',
	'object-curly-spacing': ['error', 'always'],
	'object-shorthand': 'error',
	'one-var': ['error', 'never'],
	'one-var-declaration-per-line': 'error',
	'operator-assignment': 'error',
	'operator-linebreak': 'error',
	'padded-blocks': ['error', 'never'],
	'padding-line-between-statements': 'error',
	'prefer-arrow-callback': 'error',
	'prefer-const': 'error',
	'prefer-numeric-literals': 'error',
	'prefer-object-spread': 'error',
	'prefer-promise-reject-errors': 'error',
	'prefer-regex-literals': 'error',
	'prefer-rest-params': 'error',
	'prefer-spread': 'error',
	'prefer-template': 'error',
	radix: 'error',
	'require-yield': 'error',
	'rest-spread-spacing': 'error',
	'semi-spacing': 'error',
	'semi-style': 'error',
	'sort-vars': 'error',
	'space-before-blocks': 'error',
	'space-in-parens': 'error',
	'space-infix-ops': 'error',
	'space-unary-ops': 'error',
	'spaced-comment': 'error',
	strict: 'error',
	'switch-colon-spacing': 'error',
	'symbol-description': 'error',
	'template-curly-spacing': 'error',
	'template-tag-spacing': 'error',
	'unicode-bom': 'error',
	'use-isnan': 'error',
	'vars-on-top': 'error',
	'wrap-iife': 'error',
	'yield-star-spacing': 'error',
	yoda: 'error'
};

const stylisticRules = {
	'@stylistic/comma-spacing': 'error',
	'@stylistic/function-call-spacing': 'error',
	'@stylistic/lines-between-class-members': 'error',
	'@stylistic/member-delimiter-style': 'error',
	'@stylistic/no-extra-semi': 'error',
	'@stylistic/quotes': ['error', 'double', { avoidEscape: true }],
	'@stylistic/semi': 'error',
	'@stylistic/space-before-function-paren': [
		'error',
		{ anonymous: 'never', named: 'never', asyncArrow: 'always' }
	],
	'@stylistic/type-annotation-spacing': 'error'
};

const stylisticJsRules = {
	'@stylistic/quotes': ['error', 'single', { avoidEscape: true }]
};

const customLintRules = {
	'@3sixty/no-multiple-declarations': 'error',
	'@3sixty/no-deep-type-nesting': 'error',
	'@3sixty/require-internal-on-private-methods': 'error'
};

const tsRestrictedSyntaxCommon = [
	{
		selector: "NewExpression[callee.name='Error']",
		message:
			'new Error is disallowed as it is not specific enough, and bypasses the i18n formatting'
	},
	{
		selector: "NewExpression[callee.name='RangeError']",
		message: 'new RangeError is disallowed; use Guards and Validation from @3sixty/core instead'
	},
	{
		selector: "MemberExpression[object.name='process'][property.name='env']",
		message:
			'Direct access to process.env is not allowed. Use environment variable helpers or configuration instead.'
	},
	{
		selector: "MemberExpression[object.name='globalThis'][property.name='console']",
		message: 'Do not use globalThis.console; use logging component..'
	},
	{
		selector: 'BinaryExpression[operator="instanceof"]',
		message:
			'instanceof is disallowed. For checking Error types use the BaseError methods. Use type guards or other type checking methods instead.'
	},
	{
		selector:
			"Program > VariableDeclaration > VariableDeclarator[init.type='ArrowFunctionExpression']",
		message:
			'Do not define root-level functions using variable assignments. Use a function declaration instead.'
	},
	{
		selector:
			"Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.type='ArrowFunctionExpression']",
		message:
			'Do not define root-level functions using variable assignments. Use a function declaration instead.'
	}
];

const tsRestrictedSyntax = [
	{
		selector: String.raw`ImportDeclaration[source.value=/\.$/]`,
		message:
			'Importing from paths ending in "." are not allowed, use specific file import instead to avoid circular dependencies'
	},
	{
		selector: String.raw`ImportDeclaration[source.value=/\..src$/]`,
		message:
			'Importing from paths ending in "/src" are not allowed, use specific file import instead to avoid circular dependencies'
	},
	{
		selector: 'PropertyDefinition[value!=null][static=false][key.name!=CLASS_NAME]',
		message:
			'Do not use property initializers inline, perform the initialization in the constructor instead'
	},
	{
		selector: 'TSEnumDeclaration',
		message: 'Do not use enums, instead use iterable union types'
	},
	{
		selector: 'MethodDefinition[static=true] ThisExpression',
		message: 'Do not use "this" in static methods'
	},
	{
		selector: 'VariableDeclarator[definite=true]',
		message:
			'Definite assignment assertions (let x!: T) are disallowed. Restructure the code so TypeScript can infer definite assignment, or initialise to a safe default.'
	},
	{
		selector:
			":matches(BinaryExpression[operator='==='], BinaryExpression[operator='!=='], BinaryExpression[operator='=='], BinaryExpression[operator='!=']) > UnaryExpression[operator='typeof']",
		message: 'Avoid runtime typeof comparisons. Use the @3sixty/core Is.* methods instead.'
	},
	{
		selector:
			':matches(FunctionDeclaration, ArrowFunctionExpression, FunctionExpression, TSDeclareFunction, TSMethodSignature, TSCallSignatureDeclaration, TSConstructSignatureDeclaration) > Identifier.params > TSTypeAnnotation > TSObjectKeyword',
		message:
			'Do not use `object` as a parameter type. Use a specific interface, type alias, or generic constraint instead.'
	},
	{
		selector:
			'ObjectExpression > SpreadElement > ConditionalExpression[consequent.type="ObjectExpression"][consequent.properties.length=0]',
		message:
			'Avoid spreading a conditional where one branch is an empty object to omit properties. Use a property with a conditional value instead: { prop: condition ? value : undefined }.'
	},
	{
		selector:
			'ObjectExpression > SpreadElement > ConditionalExpression[alternate.type="ObjectExpression"][alternate.properties.length=0]',
		message:
			'Avoid spreading a conditional where one branch is an empty object to omit properties. Use a property with a conditional value instead: { prop: condition ? value : undefined }.'
	}
];

const tsRules = {
	'no-empty': 'off',
	'no-redeclare': 'off',
	'no-restricted-syntax': ['error', ...tsRestrictedSyntaxCommon, ...tsRestrictedSyntax],
	'no-undef': ['off'],
	'no-unused-vars': ['off'],
	'@typescript-eslint/adjacent-overload-signatures': 'error',
	'@typescript-eslint/array-type': 'error',
	'@typescript-eslint/await-thenable': 'error',
	'@typescript-eslint/ban-ts-comment': 'error',
	'@typescript-eslint/class-literal-property-style': 'error',
	'@typescript-eslint/consistent-generic-constructors': 'error',
	'@typescript-eslint/consistent-indexed-object-style': ['error', 'index-signature'],
	'@typescript-eslint/consistent-type-assertions': 'error',
	'@typescript-eslint/consistent-type-definitions': 'error',
	'@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
	'@typescript-eslint/default-param-last': 'error',
	'@typescript-eslint/dot-notation': 'error',
	'@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
	'@typescript-eslint/explicit-member-accessibility': [
		'error',
		{ overrides: { constructors: 'no-public' } }
	],
	'@typescript-eslint/member-ordering': 'error',
	'@typescript-eslint/naming-convention': [
		'error',
		{ selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
		{ selector: 'enumMember', format: ['PascalCase'] },
		{
			selector: 'method',
			format: ['camelCase', 'PascalCase'],
			leadingUnderscore: 'forbid',
			trailingUnderscore: 'forbid'
		},
		{
			selector: 'property',
			modifiers: ['static'],
			leadingUnderscore: 'forbid',
			format: ['UPPER_CASE']
		},
		{
			selector: 'property',
			modifiers: ['private'],
			leadingUnderscore: 'require',
			format: ['camelCase']
		},
		{
			selector: 'property',
			modifiers: ['static', 'private'],
			leadingUnderscore: 'require',
			format: ['UPPER_CASE', 'camelCase']
		},
		{
			selector: 'class',
			format: ['PascalCase']
		},
		{
			selector: 'parameter',
			format: ['camelCase'],
			leadingUnderscore: 'forbid'
		}
	],
	'@typescript-eslint/no-array-constructor': 'error',
	'@typescript-eslint/require-await': 'off',
	'@typescript-eslint/no-base-to-string': 'error',
	'@typescript-eslint/no-dupe-class-members': 'error',
	'@typescript-eslint/no-duplicate-type-constituents': ['error', { ignoreUnions: true }],
	'@typescript-eslint/no-dynamic-delete': 'off',
	'@typescript-eslint/no-empty-interface': 'error',
	'@typescript-eslint/no-empty-object-type': 'off',
	'@typescript-eslint/no-explicit-any': 'error',
	'@typescript-eslint/no-extra-non-null-assertion': 'error',
	'@typescript-eslint/no-extraneous-class': 'off',
	'@typescript-eslint/no-floating-promises': 'error',
	'@typescript-eslint/no-for-in-array': 'error',
	'@typescript-eslint/no-implied-eval': 'error',
	'@typescript-eslint/no-import-type-side-effects': 'error',
	'@typescript-eslint/no-invalid-void-type': 'error',
	'@typescript-eslint/no-misused-new': 'error',
	'@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
	'@typescript-eslint/no-namespace': 'error',
	'@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
	'@typescript-eslint/no-non-null-assertion': 'error',
	'@typescript-eslint/no-redundant-type-constituents': 'off',
	'@typescript-eslint/no-require-imports': 'error',
	'@typescript-eslint/no-shadow': 'error',
	'@typescript-eslint/no-this-alias': 'error',
	'@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
	'@typescript-eslint/no-unnecessary-qualifier': 'error',
	'@typescript-eslint/no-unnecessary-type-arguments': 'error',
	'@typescript-eslint/no-unnecessary-type-assertion': isCI ? 'off' : 'error',
	'@typescript-eslint/no-unused-expressions': 'error',
	'@typescript-eslint/no-unused-private-class-members': 'error',
	'@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
	'@typescript-eslint/no-unsafe-argument': 'off',
	'@typescript-eslint/no-unsafe-assignment': 'off',
	'@typescript-eslint/no-unsafe-return': 'off',
	'@typescript-eslint/no-unsafe-call': 'off',
	'@typescript-eslint/no-unsafe-member-access': 'off',
	'@typescript-eslint/no-useless-constructor': 'error',
	'@typescript-eslint/no-var-requires': 'error',
	'@typescript-eslint/only-throw-error': 'error',
	'@typescript-eslint/prefer-as-const': 'error',
	'@typescript-eslint/prefer-function-type': 'error',
	'@typescript-eslint/prefer-includes': 'error',
	'@typescript-eslint/prefer-namespace-keyword': 'error',
	'@typescript-eslint/prefer-nullish-coalescing': ['error', { ignoreConditionalTests: true }],
	'@typescript-eslint/prefer-optional-chain': 'error',
	'@typescript-eslint/prefer-promise-reject-errors': 'off',
	'@typescript-eslint/prefer-readonly': 'error',
	'@typescript-eslint/prefer-reduce-type-parameter': 'error',
	'@typescript-eslint/prefer-regexp-exec': 'error',
	'@typescript-eslint/prefer-string-starts-ends-with': 'error',
	'@typescript-eslint/prefer-ts-expect-error': 'error',
	'@typescript-eslint/promise-function-async': 'error',
	'@typescript-eslint/restrict-plus-operands': 'error',
	'@typescript-eslint/return-await': 'error',
	'@typescript-eslint/switch-exhaustiveness-check': 'off',
	'@typescript-eslint/triple-slash-reference': 'error',
	'@typescript-eslint/typedef': ['error', { arrowParameter: false }],
	'@typescript-eslint/unbound-method': 'error',
	'@typescript-eslint/unified-signatures': 'error'
};

const headerRules = {
	'header/header': [
		'error',
		'line',
		{
			pattern:
				'^( Copyright \\d{4} (IOTA Stiftung|3Sixty Trade Ltd)\\.\\r?\\n)+ SPDX-License-Identifier: Apache-2\\.0\\.(\\r?\\n|$)'
		}
	]
};

const promiseRules = {
	'promise/always-return': 'error',
	'promise/no-return-wrap': 'error',
	'promise/param-names': 'error',
	'promise/catch-or-return': 'error',
	'promise/no-multiple-resolved': 'error',
	'promise/no-nesting': 'error',
	'promise/no-promise-in-callback': 'error',
	'promise/no-callback-in-promise': 'error',
	'promise/no-new-statics': 'error',
	'promise/no-return-in-finally': 'error',
	'promise/prefer-await-to-then': 'error',
	'promise/valid-params': 'error'
};

const importRules = {
	'import/default': 'error',
	'import/export': 'error',
	'import/namespace': 'error',
	'import/no-duplicates': 'error',
	'import/no-named-as-default': 'error',
	'import/no-named-as-default-member': 'error',
	'import/order': [
		'error',
		{
			groups: ['builtin', 'external', 'internal', ['sibling', 'parent'], 'index', 'unknown'],
			alphabetize: { order: 'asc', caseInsensitive: true }
		}
	],
	'import/no-extraneous-dependencies': [
		'error',
		{
			devDependencies: [
				'**/tests/**/*.ts',
				'**/tests/**/*.js',
				'**/scripts/**/*.mjs',
				'**/*.config.js',
				'**/*.config.cjs',
				'**/*.config.mjs',
				'**/*.config.ts'
			]
		}
	]
};

const unicornRules = {
	'unicorn/better-regex': 'error',
	'unicorn/consistent-function-scoping': 'error',
	'unicorn/error-message': 'error',
	'unicorn/escape-case': 'error',
	'unicorn/expiring-todo-comments': 'error',
	'unicorn/import-style': 'error',
	'unicorn/new-for-builtins': 'error',
	'unicorn/no-abusive-eslint-disable': 'error',
	'unicorn/no-instanceof-array': 'error',
	'unicorn/no-console-spaces': 'error',
	'unicorn/no-array-callback-reference': 'error',
	'unicorn/no-hex-escape': 'error',
	'unicorn/no-nested-ternary': 'error',
	'unicorn/no-new-buffer': 'error',
	'unicorn/no-process-exit': 'error',
	'unicorn/no-unreadable-array-destructuring': 'error',
	'unicorn/no-useless-undefined': 'error',
	'unicorn/no-zero-fractions': 'error',
	'unicorn/prefer-add-event-listener': 'error',
	'unicorn/prefer-dom-node-dataset': 'error',
	'unicorn/prefer-keyboard-event-key': 'error',
	'unicorn/prefer-array-flat-map': 'error',
	'unicorn/prefer-includes': 'error',
	'unicorn/prefer-modern-dom-apis': 'error',
	'unicorn/prefer-negative-index': 'error',
	'unicorn/prefer-dom-node-append': 'error',
	'unicorn/prefer-dom-node-remove': 'error',
	'unicorn/prefer-node-protocol': 'error',
	'unicorn/prefer-number-properties': 'error',
	'unicorn/prefer-optional-catch-binding': 'error',
	'unicorn/prefer-query-selector': 'error',
	'unicorn/prefer-reflect-apply': 'error',
	'unicorn/prefer-string-starts-ends-with': 'error',
	'unicorn/prefer-string-slice': 'error',
	'unicorn/prefer-dom-node-text-content': 'error',
	'unicorn/prefer-string-trim-start-end': 'error',
	'unicorn/prefer-type-error': 'error',
	'unicorn/throw-new-error': 'error'
};

const jsDocRules = {
	'jsdoc/check-access': 'error',
	'jsdoc/check-alignment': 'error',
	'jsdoc/check-indentation': 'error',
	'jsdoc/check-line-alignment': 'error',
	'jsdoc/check-param-names': 'error',
	'jsdoc/check-property-names': 'error',
	'jsdoc/check-syntax': 'error',
	'jsdoc/check-tag-names': [
		'error',
		{
			definedTags: ['json-ld', 'json-schema']
		}
	],
	'jsdoc/check-types': 'error',
	'jsdoc/check-values': 'error',
	'jsdoc/empty-tags': 'error',
	'jsdoc/implements-on-classes': 'error',
	'jsdoc/match-description': 'error',
	'jsdoc/multiline-blocks': ['error', { noSingleLineBlocks: true }],
	'jsdoc/no-bad-blocks': 'error',
	'jsdoc/no-blank-blocks': 'error',
	'jsdoc/no-defaults': 'error',
	'jsdoc/no-types': 'error',
	'jsdoc/no-undefined-types': 'error',
	'jsdoc/require-asterisk-prefix': 'error',
	'jsdoc/require-description': 'error',
	'jsdoc/require-jsdoc': [
		'error',
		{
			require: {
				ArrowFunctionExpression: false,
				ClassDeclaration: true,
				ClassExpression: true,
				FunctionDeclaration: true,
				FunctionExpression: true,
				MethodDefinition: true
			},
			contexts: [
				'FunctionDeclaration',
				'FunctionExpression',
				'MethodDefinition',
				'PropertyDefinition',
				'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > TSAsExpression[typeAnnotation.type="TSTypeReference"][typeAnnotation.typeName.name="const"] > ObjectExpression > Property',
				'TSDeclareFunction',
				'TSEnumDeclaration',
				'TSInterfaceDeclaration',
				'TSMethodDeclaration',
				'TSMethodSignature',
				'TSPropertySignature:not(TSTypeLiteral > TSPropertySignature)',
				'TSTypeAliasDeclaration'
			]
		}
	],
	'jsdoc/require-param': [
		'error',
		{
			contexts: [
				'FunctionDeclaration',
				'FunctionExpression',
				'MethodDefinition',
				'TSDeclareFunction',
				'TSMethodDeclaration',
				'TSMethodSignature'
			]
		}
	],
	'jsdoc/require-param-description': 'error',
	'jsdoc/require-param-name': 'error',
	'jsdoc/require-property': 'error',
	'jsdoc/require-property-description': 'error',
	'jsdoc/require-property-name': 'error',
	'jsdoc/require-property-type': 'error',
	'jsdoc/require-returns': [
		'error',
		{
			contexts: [
				'FunctionDeclaration',
				'FunctionExpression',
				'MethodDefinition',
				'TSDeclareFunction',
				'TSMethodDeclaration',
				'TSMethodSignature'
			]
		}
	],
	'jsdoc/require-returns-check': 'error',
	'jsdoc/require-returns-description': 'error',
	'jsdoc/require-throws': 'error',
	'jsdoc/require-yields': 'error',
	'jsdoc/require-yields-check': 'error',
	'jsdoc/valid-types': 'error'
};

const allRules = {
	tsRules,
	jsRules,
	stylisticRules,
	stylisticJsRules,
	headerRules,
	promiseRules,
	importRules,
	unicornRules,
	jsDocRules,
	customLintRules
};

if (customModule?.extendRules) {
	customModule.extendRules(allRules);
}

const config = [
	// Global ignores
	{
		ignores: ['**/dist/**', '**/coverage/**', '**/vitest.config.ts.timestamp*', '**/.tmp/**']
	},

	// Repository structure naming validation.
	{
		files: ['scripts/eslint-plugin-repo-structure.mjs'],
		plugins: {
			'@3sixty': customLintPlugin
		},
		rules: {
			'@3sixty/validate-repo-structure': 'error'
		}
	},

	// Base JavaScript configuration
	js.configs.recommended,

	// JavaScript files
	{
		files: ['**/*.js', '**/*.mjs'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.browser,
				...globals.node
			}
		},
		plugins: {
			import: importPlugin,
			promise: promisePlugin,
			jsdoc: jsdocPlugin,
			unicorn: unicornPlugin,
			'unused-imports': unusedImportsPlugin,
			'simple-import-sort': simpleImportSortPlugin,
			header: headerPlugin,
			'@stylistic': stylistic
		},
		rules: {
			// Base JavaScript rules from your config
			...jsRules,

			// Import rules
			...importRules,

			// Promise rules
			...promiseRules,

			// Header rule
			...headerRules,

			// Unicorn rules
			...unicornRules,

			// Stylistic rules
			...stylisticRules,
			...stylisticJsRules
		}
	},

	// TypeScript source and test files
	{
		files: ['**/*.ts', '**/*.spec.ts'],
		languageOptions: {
			parser: typescriptParser,
			parserOptions: {
				ecmaVersion: 2022,
				project: './tsconfig.eslint.json',
				sourceType: 'module',
				tsconfigRootDir: import.meta.dirname
			},
			globals: {
				...globals.browser,
				...globals.node
			}
		},
		plugins: {
			'@typescript-eslint': typescript,
			import: importPlugin,
			promise: promisePlugin,
			jsdoc: jsdocPlugin,
			unicorn: unicornPlugin,
			'unused-imports': unusedImportsPlugin,
			'simple-import-sort': simpleImportSortPlugin,
			header: headerPlugin,
			'@stylistic': stylistic,
			'@3sixty': customLintPlugin
		},
		rules: {
			// Extend recommended TypeScript rules
			...typescript.configs.recommended.rules,
			...typescript.configs['recommended-requiring-type-checking'].rules,
			...typescript.configs.strict.rules,

			...jsRules,

			// TypeScript rules
			...tsRules,

			// JSDoc rules
			...jsDocRules,

			// Unicorn rules
			...unicornRules,

			// Import rules
			...importRules,

			// Promise rules
			...promiseRules,

			// Header rule
			...headerRules,

			// Stylistic
			...stylisticRules,

			// Custom lint rules
			...customLintRules
		},
		settings: {
			jsdoc: {
				mode: 'typescript'
			}
		}
	},

	// Bin entry files can import package dist entrypoints.
	{
		files: ['**/bin/index.js'],
		rules: {
			'no-restricted-imports': 'off'
		}
	},
	// Test files
	{
		files: ['**/tests/**/*.ts'],
		rules: {
			'max-classes-per-file': 'off',
			'no-console': 'off',
			'jsdoc/require-jsdoc': 'off',
			'unicorn/consistent-function-scoping': 'off',
			'unicorn/no-useless-undefined': 'off',
			'no-restricted-syntax': ['error', ...tsRestrictedSyntax],
			'@typescript-eslint/unbound-method': 'off',
			'@3sixty/no-multiple-declarations': 'off',
			'@3sixty/no-deep-type-nesting': 'off',
			'@3sixty/require-internal-on-private-methods': 'off'
		}
	}
];

if (customModule?.extendConfig) {
	customModule.extendConfig(allRules, config);
}

export default config;
