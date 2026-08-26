import { parseMarketData, parseMaxProfitableBid } from './marketTrendsScraper';

describe('marketTrendsScraper', () => {
  test('conserva el id de FútbolFantasy al leer el mercado', () => {
    const html = `
      <select name="equipo"><option value="3">Barcelona</option></select>
      <tr class="elemento_jugador" data-id="123" data-nombre="pedri"
        data-posicion="Mediocampista" data-equipo="3" data-valor="50000000"
        data-diferencia1="250000" data-diferencia-pct1="0.5"></tr>`;

    const players = [...parseMarketData(html).values()];
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ futbolFantasyId: '123', valor: 50000000 });
  });

  test('extrae la puja máxima rentable oficial del detalle', () => {
    expect(parseMaxProfitableBid('puja_ideal = parsePujaIdeal(890377\n )')).toBe(890377);
  });

  test('distingue Sin rentabilidad (cero) de un dato ausente', () => {
    expect(parseMaxProfitableBid('puja_ideal = parsePujaIdeal(0 );')).toBe(0);
    expect(parseMaxProfitableBid('<html>sin la variable</html>')).toBeNull();
  });
});
