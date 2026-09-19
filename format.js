function getYouTubeVideoId(url) {
    if (!url) return null;
    const str = String(url).trim();
    const patterns = [
        /(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)([a-zA-Z0-9_-]{11})/,
        /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const pattern of patterns) {
        const match = str.match(pattern);
        if (match) return match[1];
    }
    return null;
}

function parseDurationToSeconds(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !value.trim()) return null;

    const matches = [...value.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/gi)];
    if (!matches.length) return null;

    const parts = {};
    for (const match of matches) {
        const unit = match[2].toLowerCase();
        if (parts[unit] !== undefined) return null;
        parts[unit] = Number(match[1]);
    }
    if (parts.m >= 60 || parts.s >= 60) return null;

    const seconds = (parts.h || 0) * 3600 + (parts.m || 0) * 60 + (parts.s || 0);
    return Number.isFinite(seconds) ? seconds : null;
}

function formatSecondsAsDuration(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';

    const wholeSeconds = Math.round(seconds);
    const parts = [];
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const remainingSeconds = wholeSeconds % 60;
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (remainingSeconds || !parts.length) parts.push(`${remainingSeconds}s`);
    return parts.join(' ');
}

function buildYoutubeCdnUrls(videoId) {
    return [
        `https://img.youtube.com/vi/${videoId}/hq1.jpg`
    ];
}

function getYouTubeThumbnailUrls(videoId) {
    if (!videoId) return [];
    return buildYoutubeCdnUrls(videoId);
}

function getThumbnailUrlSequence(thumbnail, showcaseVideo, playerVideo, levelID, extraVideoUrls = []) {
    if (thumbnail) {
        return [thumbnail];
    }
    const urls = [];
    const rawVideoUrls = [showcaseVideo, playerVideo, ...(Array.isArray(extraVideoUrls) ? extraVideoUrls : [])]
        .filter(Boolean);

    const uniqueVideoIds = [];
    const seenVideoIds = new Set();
    for (const videoUrl of rawVideoUrls) {
        const videoId = getYouTubeVideoId(videoUrl);
        if (!videoId || seenVideoIds.has(videoId)) continue;
        seenVideoIds.add(videoId);
        uniqueVideoIds.push(videoId);
    }

    for (const videoId of uniqueVideoIds) {
        urls.push(`https://raw.githubusercontent.com/AncepsGD/practice-mode-list/main/thumbnails/${videoId}.webp`);
        urls.push(`https://raw.githubusercontent.com/AncepsGD/practice-mode-list/main/thumbnails/${videoId}.png`);
    }

    if (levelID) {
        urls.push(`https://levelthumbs.prevter.me/thumbnail/${levelID}`);
    }

    for (const videoId of uniqueVideoIds) {
        urls.push(...buildYoutubeCdnUrls(videoId));
    }

    return urls;
}

window.getThumbnailUrlSequence = getThumbnailUrlSequence;
window.getYouTubeVideoId = getYouTubeVideoId;
window.getYouTubeThumbnailUrls = getYouTubeThumbnailUrls;