import { readFile } from 'node:fs/promises';
import path from 'node:path';

type JsonObject = Record<string, unknown>;

type LocaleShot = {
  line1: string;
  line2: string;
};

type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: string;
  canvasCount: number;
  currentCanvasId: string;
  source: string;
};

type TextBoxModel = {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontKey: string;
  color: string;
};

type CanvasState = {
  canvasPresetId: string;
  backgroundMode: string;
  backgroundPrimary: string;
  backgroundSecondary: string;
  gradientAngle: number;
  phoneOffset: { x: number; y: number };
  phoneScale: number;
  textBoxes: TextBoxModel[];
  media: { kind: string | null; name: string };
};

type ProjectCanvas = {
  id: string;
  name: string;
  state: CanvasState;
  thumbnailDataUrl?: string;
};

type ProjectState = {
  currentCanvasId: string;
  canvases: ProjectCanvas[];
};

type FullProjectResponse = {
  project: ProjectSummary;
  state: ProjectState;
  rawFile: {
    project: { id: string; name: string; updatedAt: string };
    state: ProjectState;
    version?: string;
    canvas?: unknown;
  };
};

type CanvasMetaResponse = {
  project: ProjectSummary;
  canvasMeta: {
    canvasId: string;
    canvasName: string;
    canvasPreset: { width: number; height: number; id: string; label: string };
    textBoxes: Array<{
      id: string;
      text: string;
      x: number;
      y: number;
      width: number;
      lineCount: number;
      wrappedByWidth: boolean;
      maxLineWidth: number;
      bounds: { x: number; y: number; width: number; height: number };
    }>;
  };
};

type MediaMetaResponse = {
  project: ProjectSummary;
  canvasId: string;
  media: null | {
    kind: 'image' | 'video';
    name: string;
    type: string;
    bytes?: number;
  };
};

type ProjectsListResponse = {
  projects: ProjectSummary[];
  total: number;
};

type CloneProjectResponse = {
  project: ProjectSummary;
  clonedFrom: string;
  mediaCopy?: { expected: number; copied: number; missing: number };
};

type ImportResponse = {
  imported: boolean;
  project: ProjectSummary;
};

type Options = {
  apiBase: string;
  sourceProjectName: string;
  targetProjectName: string;
  locale: string;
  i18nJsonPath: string;
  dryRun: boolean;
};

function printUsage() {
  console.log(`
Usage:
  pnpm dlx tsx scripts/ios-appstore-preview-clone-locale.ts \\
    --locale <locale> \\
    --target-project-name <name> \\
    [--source-project-name <name>] \\
    [--api-base <url>] \\
    [--i18n-json <path>] \\
    [--dry-run]

Defaults:
  --api-base http://localhost:4318
  --source-project-name "Mingle 한국어"
  --i18n-json rn/appstore-connect-info/appstore-connect-info.i18n.json
`);
}

function parseArgs(argv: string[]): Options {
  const args = [...argv];
  const nextValue = (flag: string): string => {
    const value = args.shift();
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  const options: Options = {
    apiBase: 'http://localhost:4318',
    sourceProjectName: 'Mingle 한국어',
    targetProjectName: '',
    locale: '',
    i18nJsonPath: 'rn/appstore-connect-info/appstore-connect-info.i18n.json',
    dryRun: false,
  };

  while (args.length > 0) {
    const token = args.shift();
    if (!token) break;
    switch (token) {
      case '--api-base':
        options.apiBase = nextValue(token);
        break;
      case '--source-project-name':
        options.sourceProjectName = nextValue(token);
        break;
      case '--target-project-name':
        options.targetProjectName = nextValue(token);
        break;
      case '--locale':
        options.locale = nextValue(token);
        break;
      case '--i18n-json':
        options.i18nJsonPath = nextValue(token);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!options.locale) throw new Error('--locale is required');
  if (!options.targetProjectName) throw new Error('--target-project-name is required');
  return options;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T) : ({} as T);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} at ${url}\n${text}`);
  }
  return payload;
}

function pickLatestByName(projects: ProjectSummary[], name: string): ProjectSummary | null {
  const candidates = projects.filter((project) => project.name === name);
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1) ?? null;
}

function parseLocaleShots(i18n: JsonObject, locale: string): LocaleShot[] {
  const fromIosSubmission = (((i18n.ios as JsonObject | undefined)?.submission as JsonObject | undefined)?.screenshots as
    | JsonObject
    | undefined)?.[locale];
  const fromLegacyScreenshots = (i18n.screenshots as JsonObject | undefined)?.[locale];
  const fromLegacyLocalizations = ((((i18n.localizations as JsonObject | undefined)?.[locale] as JsonObject | undefined)
    ?.screenshots as unknown) ?? null) as unknown;

  const raw = fromIosSubmission ?? fromLegacyScreenshots ?? fromLegacyLocalizations;
  if (!Array.isArray(raw)) {
    throw new Error(`Locale screenshots not found for "${locale}" in i18n json`);
  }

  const shots = raw.map((item, index) => {
    const row = item as Partial<LocaleShot>;
    if (!row || typeof row.line1 !== 'string' || typeof row.line2 !== 'string') {
      throw new Error(`Invalid screenshot row at index ${index} for locale "${locale}"`);
    }
    return {
      line1: row.line1,
      line2: row.line2,
    };
  });
  return shots;
}

function assignLineText(textBoxes: TextBoxModel[], shot: LocaleShot): TextBoxModel[] {
  const next = textBoxes.map((box) => ({ ...box }));
  let line1Assigned = false;
  let line2Assigned = false;

  for (const box of next) {
    if (box.id === 'text-1') {
      box.text = shot.line1;
      line1Assigned = true;
    } else if (box.id === 'text-3') {
      box.text = shot.line2;
      line2Assigned = true;
    }
  }

  if (!line1Assigned || !line2Assigned) {
    const byTop = [...next].sort((a, b) => a.y - b.y);
    if (!line1Assigned && byTop[0]) byTop[0].text = shot.line1;
    if (!line2Assigned && byTop[1]) byTop[1].text = shot.line2;
  }

  return next;
}

function buildImportPayloadForLocale(targetRawFile: FullProjectResponse['rawFile'], shots: LocaleShot[]) {
  const nextCanvases = targetRawFile.state.canvases.map((canvas, index) => {
    const shot = shots[index];
    if (!shot) return canvas;
    return {
      ...canvas,
      name: shot.line1,
      state: {
        ...canvas.state,
        textBoxes: assignLineText(canvas.state.textBoxes, shot),
      },
    };
  });

  return {
    ...targetRawFile,
    state: {
      ...targetRawFile.state,
      canvases: nextCanvases,
    },
  };
}

async function cloneMediaByIndex(
  apiBase: string,
  sourceProject: FullProjectResponse,
  targetProject: FullProjectResponse,
) {
  const sourceCanvases = sourceProject.state.canvases;
  const targetCanvases = targetProject.state.canvases;
  const count = Math.min(sourceCanvases.length, targetCanvases.length);

  for (let i = 0; i < count; i += 1) {
    const sourceCanvas = sourceCanvases[i];
    const targetCanvas = targetCanvases[i];
    const metaUrl = `${apiBase}/api/projects/${sourceProject.project.id}/canvases/${sourceCanvas.id}/media/meta`;
    const meta = await fetchJson<MediaMetaResponse>(metaUrl);
    if (!meta.media || !meta.media.kind || !meta.media.name) {
      continue;
    }

    const mediaUrl = `${apiBase}/api/projects/${sourceProject.project.id}/canvases/${sourceCanvas.id}/media`;
    const mediaResponse = await fetch(mediaUrl);
    if (!mediaResponse.ok) {
      continue;
    }
    const buffer = await mediaResponse.arrayBuffer();
    const contentType =
      mediaResponse.headers.get('content-type') ||
      (meta.media.kind === 'video' ? 'video/mp4' : 'image/png');

    const uploadUrl = `${apiBase}/api/projects/${targetProject.project.id}/canvases/${targetCanvas.id}/media?kind=${encodeURIComponent(meta.media.kind)}&name=${encodeURIComponent(meta.media.name)}`;
    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: buffer,
    });
    if (!putResponse.ok) {
      const body = await putResponse.text();
      throw new Error(`Failed to copy media to ${targetCanvas.id}: ${putResponse.status} ${body}`);
    }
  }
}

async function fitAndCenterTextBoxes(apiBase: string, projectId: string) {
  const full = await fetchJson<FullProjectResponse>(
    `${apiBase}/api/projects/${projectId}/full?includeMeta=false&includeRawFile=false`,
  );

  for (const canvas of full.state.canvases) {
    const metaUrl = `${apiBase}/api/projects/${projectId}/canvases/${canvas.id}/meta`;
    const patchUrl = `${apiBase}/api/projects/${projectId}/canvases/${canvas.id}/text-boxes`;

    const initialMeta = await fetchJson<CanvasMetaResponse>(metaUrl);
    if (initialMeta.canvasMeta.textBoxes.length === 0) continue;

    const widenUpdates = initialMeta.canvasMeta.textBoxes.map((box) => ({
      id: box.id,
      width: 1200,
    }));
    await fetchJson<JsonObject>(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: widenUpdates }),
    });

    const measuredMeta = await fetchJson<CanvasMetaResponse>(metaUrl);
    const canvasWidth = measuredMeta.canvasMeta.canvasPreset.width;
    const fitUpdates = measuredMeta.canvasMeta.textBoxes.map((box) => {
      const fittedWidth = Math.max(120, Math.ceil(box.maxLineWidth) + 4);
      return {
        id: box.id,
        width: fittedWidth,
        x: (canvasWidth - fittedWidth) / 2,
      };
    });

    await fetchJson<JsonObject>(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: fitUpdates }),
    });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiBase = options.apiBase.replace(/\/+$/, '');
  const i18nPath = path.resolve(process.cwd(), options.i18nJsonPath);

  const raw = await readFile(i18nPath, 'utf8');
  const i18n = JSON.parse(raw) as JsonObject;
  const shots = parseLocaleShots(i18n, options.locale);

  const projectsList = await fetchJson<ProjectsListResponse>(`${apiBase}/api/projects`);
  const source = pickLatestByName(projectsList.projects, options.sourceProjectName);
  if (!source) {
    throw new Error(`Source project not found: ${options.sourceProjectName}`);
  }

  console.log(`[info] source=${source.name} (${source.id})`);
  console.log(`[info] target=${options.targetProjectName}`);
  console.log(`[info] locale=${options.locale}`);
  console.log(`[info] shots=${shots.length}`);

  if (options.dryRun) {
    return;
  }

  const cloned = await fetchJson<CloneProjectResponse>(`${apiBase}/api/projects/${source.id}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: options.targetProjectName }),
  });

  console.log(`[clone] id=${cloned.project.id} from=${cloned.clonedFrom}`);

  const targetFull = await fetchJson<FullProjectResponse>(
    `${apiBase}/api/projects/${cloned.project.id}/full?includeMeta=true&includeRawFile=true&includeThumbnails=true`,
  );

  const payload = buildImportPayloadForLocale(targetFull.rawFile, shots);
  const imported = await fetchJson<ImportResponse>(`${apiBase}/api/projects/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, force: true }),
  });

  console.log(`[import] id=${imported.project.id} revision updated`);

  const sourceFull = await fetchJson<FullProjectResponse>(
    `${apiBase}/api/projects/${source.id}/full?includeMeta=true&includeRawFile=false&includeThumbnails=true`,
  );
  const refreshedTarget = await fetchJson<FullProjectResponse>(
    `${apiBase}/api/projects/${imported.project.id}/full?includeMeta=true&includeRawFile=false&includeThumbnails=true`,
  );

  await cloneMediaByIndex(apiBase, sourceFull, refreshedTarget);
  console.log('[media] copy by canvas index done');

  await fitAndCenterTextBoxes(apiBase, imported.project.id);
  console.log('[layout] text width fit + x-center done');

  const finalState = await fetchJson<FullProjectResponse>(
    `${apiBase}/api/projects/${imported.project.id}/full?includeMeta=false&includeRawFile=false`,
  );
  const rows = finalState.state.canvases.map((canvas, index) => ({
    index: index + 1,
    id: canvas.id,
    name: canvas.name,
    textBoxes: canvas.state.textBoxes.map((box) => ({
      id: box.id,
      text: box.text,
      width: box.width,
      x: box.x,
      y: box.y,
    })),
  }));
  console.log(JSON.stringify({ project: finalState.project, canvases: rows }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});

