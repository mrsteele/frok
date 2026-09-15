import fs from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = async file => JSON.parse(await fs.readFile(new URL(file, root), 'utf8'));
const metadataFiles = groups => groups.flat().filter(file => file.endsWith('/meta.json'));

export default {
  watch: ['../../desktop/pipelines.json', ...metadataFiles(await read('desktop/pipelines.json')).map(file => `../../resources/pipelines/${file}`)],
  async load() {
    // Publish only the explicit shipped manifest, never local/custom workflows.
    const files = metadataFiles(await read('desktop/pipelines.json'));
    const definitions = await Promise.all(files.map(file => read(`resources/pipelines/${file}`)));
    return definitions.filter(item => item.runner === 'comfyui').map(({ id, name, dependencies }) => ({ id, name, dependencies }));
  },
};
