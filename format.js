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