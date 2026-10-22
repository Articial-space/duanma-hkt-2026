/** @type {import('next').NextConfig} */
const nextConfig = {
  // Do not let `next dev` write AI-agent instructions (AGENTS.md) into the app (Next >= 16.3).
  agentRules: false,
  // S11: the TruthVoice core lives outside the app package (../core/src).
  experimental: {
    externalDir: true,
  },
  webpack: (config) => {
    // Core sources are ESM TypeScript importing siblings as "./x.js"; resolve those to the .ts files.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.ts', '.tsx', '.js'],
    }
    return config
  },
}
module.exports = nextConfig
