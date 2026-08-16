import { Buffer } from 'node:buffer';
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const FOOTBALL_DATA_BASE_URL = 'https://api.football-data.org/v4';
const SUPPORTED_COMPETITION_CODES = new Set(['DED', 'PL']);
const CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const LIVE_MATCH_STATUSES = new Set(['LIVE', 'IN_PLAY', 'PAUSED']);
const nodeRuntime = globalThis as typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

interface FirebaseServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

interface FootballCacheDocument {
  data?: any;
  cachedAt?: number;
}

function getFootballDatabase(): Firestore {
  const encodedCredentials = nodeRuntime.process?.env?.['FIREBASE_SERVICE_ACCOUNT_BASE64'];

  if (!encodedCredentials) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 is not configured.');
  }

  let serviceAccount: FirebaseServiceAccount;

  try {
    serviceAccount = JSON.parse(
      Buffer.from(encodedCredentials, 'base64').toString('utf8'),
    ) as FirebaseServiceAccount;
  } catch {
    throw new Error('The Firebase service-account credentials could not be decoded.');
  }

  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('The Firebase service-account credentials are incomplete.');
  }

  const firebaseApp =
    getApps().length > 0
      ? getApp()
      : initializeApp({
          credential: cert({
            projectId: serviceAccount.project_id,
            clientEmail: serviceAccount.client_email,
            privateKey: serviceAccount.private_key,
          }),
        });

  return getFirestore(firebaseApp);
}

function createFootballResponse(
  data: any,
  cacheStatus: 'HIT' | 'MISS' | 'STALE' | 'BYPASS',
): Response {
  return Response.json(data, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'X-Football-Cache': cacheStatus,
    },
  });
}

const asTeam = (raw: any) => ({
  id: raw?.id ?? 0,
  name: raw?.name ?? 'Unknown',
  shortName: raw?.shortName ?? null,
  tla: raw?.tla ?? null,
  crest: raw?.crest ?? null,
});

const asScore = (raw: any) => ({
  home: raw?.home ?? null,
  away: raw?.away ?? null,
});

const asStanding = (raw: any) => ({
  position: raw?.position ?? 0,
  team: asTeam(raw?.team),
  playedGames: raw?.playedGames ?? 0,
  form: typeof raw?.form === 'string' && raw.form.length > 0 ? raw.form.split(',') : [],
  won: raw?.won ?? 0,
  draw: raw?.draw ?? 0,
  lost: raw?.lost ?? 0,
  points: raw?.points ?? 0,
  goalsFor: raw?.goalsFor ?? 0,
  goalsAgainst: raw?.goalsAgainst ?? 0,
  goalDifference: raw?.goalDifference ?? 0,
});

const asMatch = (raw: any) => ({
  id: raw?.id ?? 0,
  utcDate: raw?.utcDate ?? '',
  status: raw?.status ?? 'SCHEDULED',
  matchday: raw?.matchday ?? null,

  venue: raw?.venue ?? null,

  referee: Array.isArray(raw?.referees)
    ? (raw.referees.find((referee: any) => referee?.type === 'REFEREE')?.name ?? null)
    : null,

  homeTeam: asTeam(raw?.homeTeam),
  awayTeam: asTeam(raw?.awayTeam),

  score: {
    winner: raw?.score?.winner ?? null,
    fullTime: asScore(raw?.score?.fullTime),
    halfTime: asScore(raw?.score?.halfTime),
  },

  lastUpdated: raw?.lastUpdated ?? null,
});

async function requestFootballData(path: string, token: string): Promise<any> {
  const response = await fetch(`${FOOTBALL_DATA_BASE_URL}${path}`, {
    headers: {
      'X-Auth-Token': token,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`football-data.org responded with status ${response.status}.`);
  }

  return response.json();
}

export async function GET(request: Request): Promise<Response> {
  const requestedCompetition =
    new URL(request.url).searchParams.get('competition')?.toUpperCase() ?? 'DED';

  if (!SUPPORTED_COMPETITION_CODES.has(requestedCompetition)) {
    return Response.json({ error: 'Unsupported competition.' }, { status: 400 });
  }

  let cachedData: any = null;

  try {
    const database = getFootballDatabase();
    const cacheReference = database.collection('footballCache').doc(requestedCompetition);

    const cacheSnapshot = await cacheReference.get();

    const cacheDocument = cacheSnapshot.exists
      ? (cacheSnapshot.data() as FootballCacheDocument)
      : null;

    cachedData = cacheDocument?.data ?? null;

    const cachedAt = typeof cacheDocument?.cachedAt === 'number' ? cacheDocument.cachedAt : null;

    const cacheIsFresh =
      cachedData !== null && cachedAt !== null && Date.now() - cachedAt < CACHE_MAX_AGE_MS;

    if (cacheIsFresh) {
      return createFootballResponse(cachedData, 'HIT');
    }

    const token = nodeRuntime.process?.env?.['FOOTBALL_DATA_TOKEN'];

    if (!token) {
      if (cachedData) {
        return createFootballResponse(cachedData, 'STALE');
      }

      return Response.json({ error: 'FOOTBALL_DATA_TOKEN is not configured.' }, { status: 500 });
    }

    const [standingsData, matchesData] = await Promise.all([
      requestFootballData(`/competitions/${requestedCompetition}/standings`, token),
      requestFootballData(`/competitions/${requestedCompetition}/matches`, token),
    ]);

    const totalStanding = standingsData.standings?.find(
      (standing: any) => standing.type === 'TOTAL',
    );

    if (!totalStanding) {
      throw new Error('The API response contained no total standings.');
    }

    const standings = totalStanding.table.map(asStanding);

    const matches = matchesData.matches
      .map(asMatch)
      .filter((match: any) => match.matchday !== null)
      .sort(
        (first: any, second: any) =>
          first.matchday - second.matchday || first.utcDate.localeCompare(second.utcDate),
      );

    const refreshedData = {
      competition: {
        id: standingsData.competition.id,
        name: standingsData.competition.name,
        code: standingsData.competition.code,
        emblem: standingsData.competition.emblem ?? null,
      },
      season: {
        id: standingsData.season.id,
        startDate: standingsData.season.startDate,
        endDate: standingsData.season.endDate,
        currentMatchday: standingsData.season.currentMatchday,
      },
      standings,
      matches,
      updatedAt: new Date().toISOString(),
    };

    const hasLiveMatch = matches.some((match: any) => LIVE_MATCH_STATUSES.has(match.status));

    const responseData =
      hasLiveMatch && cachedData?.standings
        ? {
            ...refreshedData,
            standings: cachedData.standings,
          }
        : refreshedData;

    /*
     * While a match is live:
     * - Preserve previously stored completed-match standings.
     * - Store newly refreshed match data.
     *
     * If no cache exists yet during a live match, return the provider response
     * without storing its provisional standings.
     */
    if (!hasLiveMatch || cachedData?.standings) {
      await cacheReference.set({
        data: responseData,
        cachedAt: Date.now(),
      });
    }

    const cacheStatus = hasLiveMatch && !cachedData?.standings ? 'BYPASS' : 'MISS';

    return createFootballResponse(responseData, cacheStatus);
  } catch (error) {
    if (cachedData) {
      console.error(
        `Unable to refresh ${requestedCompetition} data. Serving the cached snapshot instead:`,
        error,
      );

      return createFootballResponse(cachedData, 'STALE');
    }
    console.error(`Unable to retrieve ${requestedCompetition} data:`, error);

    return Response.json({ error: 'Unable to retrieve competition data.' }, { status: 502 });
  }
}
