import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'
import eslintConfigPrettier from 'eslint-config-prettier'

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'agent-rules/**',
      'agent-rules-tools/**',
      'agent-rules-local/**',
      'data/**',
      'next-env.d.ts',
    ],
  },
  eslintConfigPrettier,
]

export default eslintConfig
