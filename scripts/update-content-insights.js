const path = require('path');
const axiosPackagePath = require.resolve('axios/package.json');
const axios = require(path.join(path.dirname(axiosPackagePath), 'dist/node/axios.cjs'));
const { createContentInsightsService } = require('../server/content-insights');

const outputDir = process.env.CONTENT_INSIGHTS_OUTPUT_DIR
  ? path.resolve(process.cwd(), process.env.CONTENT_INSIGHTS_OUTPUT_DIR)
  : path.resolve(process.cwd(), 'data', 'content-insights');

const service = createContentInsightsService({
  axios,
  cacheDir: outputDir,
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL || 'gemini-3.7-flash',
});

const run = async () => {
  for (const type of ['recommendations', 'messi']) {
    const result = await service.refresh(type);
    console.log(`${type}: ${result.content.video.title} (${result.changed ? 'actualizado' : 'sin cambios'})`);
  }
};

run().catch((error) => {
  const apiError = error.response?.data;
  console.error(apiError ? JSON.stringify(apiError, null, 2) : (error.message || error));
  process.exitCode = 1;
});
