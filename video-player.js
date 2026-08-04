(function (global) {
  function getEmbedVideoUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return '';

    const trimmed = rawUrl.trim();
    if (!trimmed) return '';

    const youtubeMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)([a-zA-Z0-9_-]{11})/i)
      || trimmed.match(/(?:https?:\/\/)?(?:www\.|m\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i);

    if (youtubeMatch && youtubeMatch[1]) {
      return `https://www.youtube-nocookie.com/embed/${youtubeMatch[1]}?autoplay=1&rel=0`;
    }

    const vimeoMatch = trimmed.match(/https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i);
    if (vimeoMatch && vimeoMatch[1]) {
      return `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1`;
    }

    if (/\.(mp4|webm|ogg)(?:$|[?#])/i.test(trimmed)) {
      return trimmed;
    }

    return '';
  }

  global.getEmbedVideoUrl = getEmbedVideoUrl;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getEmbedVideoUrl };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
