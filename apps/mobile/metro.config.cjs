const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Hoisted dependencies otherwise resolve the server's React instead of the SDK's version.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return { type: 'sourceFile', filePath: require.resolve(moduleName) };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
