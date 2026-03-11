export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "generated/**",
      ".prisma/**",
      "coverage/**",
      "public/temp/**",
    ],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-undef": "off",
    },
  },
];
