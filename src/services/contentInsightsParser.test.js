const { parseYouTubeFeed, selectLatestVideo, normalizeAnalysis } = require('../../server/content-insights');

const FEED = `<?xml version="1.0"?><feed>
  <entry><yt:videoId>new-buy</yt:videoId><title>COMPRAS y VENTAS FANTASY tras la JORNADA 3</title><published>2026-08-27T09:00:00Z</published></entry>
  <entry><yt:videoId>new-xi</yt:videoId><title>Los MEJORES JUGADORES para la JORNADA 3</title><published>2026-08-26T09:00:00Z</published></entry>
  <entry><yt:videoId>cheap-xi</yt:videoId><title>Mi ALINEACIÓN de CHOLLOS FANTASY para la JORNADA 3</title><published>2026-08-25T09:00:00Z</published></entry>
</feed>`;

describe('content insights ingestion', () => {
  test('distingue los dos formatos sin confundir la alineación de chollos', () => {
    const videos = parseYouTubeFeed(FEED);
    expect(selectLatestVideo(videos, 'recommendations').id).toBe('new-buy');
    expect(selectLatestVideo(videos, 'messi').id).toBe('new-xi');
  });

  test('normaliza nombres, tiempos y secciones incompletas', () => {
    const content = normalizeAnalysis({
      summary: 'Resumen', matchday: 3,
      sections: [{ title: 'Delanteros', players: [{ name: 'Ante Budimir', timestampSeconds: '1108' }] }],
    }, 'messi', { id: 'new-xi', url: 'https://www.youtube.com/watch?v=new-xi' });
    expect(content.sections[0].players[0]).toEqual(expect.objectContaining({ name: 'Ante Budimir', timestampSeconds: 1108 }));
    expect(content.matchday).toBe(3);
  });
});
