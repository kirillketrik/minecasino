import { useAuth } from '../auth.tsx'
import { coins } from '../format.ts'
import { dataUrl } from '../game/sprites.ts'
import type { SpriteName } from '../game/sprites.ts'
import { useGameInfo } from '../ui/bet.tsx'
import { PageHead } from '../ui/shell.tsx'

type Entry = {
  id: 'mines' | 'creeper' | 'ender' | 'drill' | 'elytra'
  name: string
  pitch: string
  facts: string[]
  art: SpriteName[][]
}

const GAMES: Entry[] = [
  {
    id: 'mines',
    name: 'Шахта',
    pitch:
      'Слот 5×3 на 20 линий. Кирка заменяет любой блок, три динамита открывают 10 бесплатных спинов с множителем до ×10, а выигрыш можно рискнуть на кристалле.',
    facts: ['20 линий', 'Фриспины ×2…×10', 'Риск на кристалле'],
    art: [
      ['coal', 'iron', 'pickaxe', 'gold', 'diamond'],
      ['iron', 'dynamite', 'gold', 'pickaxe', 'coal'],
    ],
  },
  {
    id: 'creeper',
    name: 'Крипер',
    pitch:
      'Поле 6×5. Восемь одинаковых блоков в любом месте взрываются и платят, новые падают сверху. С каждой волной множитель растёт, а Крипер умножает весь выигрыш.',
    facts: ['Кластеры от 8', 'Множитель волны до ×10', 'Крипер ×2…×10'],
    art: [
      ['gunpowder', 'creeper', 'emerald', 'skull'],
      ['lapis', 'gunpowder', 'diamond', 'redstone'],
    ],
  },
  {
    id: 'ender',
    name: 'Врата Края',
    pitch:
      'Поле 6×5 в стиле Края. Восемь одинаковых блоков в любом месте платят, новые падают сверху. Драконьи яйца ×2…×500 складываются и множат выигрыш, а кристаллы Края платят сами и дарят 15 бесплатных вращений.',
    facts: ['Кластеры от 8', 'Яйца ×2…×500', 'Копящийся множитель в бонусе'],
    art: [
      ['chorus', 'egg', 'eye', 'head'],
      ['obsidian', 'crystal', 'shulker', 'wings'],
    ],
  },
  {
    id: 'drill',
    name: 'Бурение',
    pitch:
      'Шахта 5×7: сверху падают кирки пяти уровней, динамит и бур. Они пробиваются сквозь землю, руды и обсидиан к сундукам, а чем глубже и твёрже блок, тем больше он платит. Главный сундук приносит до 100 ставок.',
    facts: ['Кирки, динамит и бур', 'Сундуки до 100×', 'Один сундук главный'],
    art: [
      ['dirt', 'coal', 'iron', 'gold'],
      ['pickaxe', 'dynamite', 'drill', 'chest'],
    ],
  },
  {
    id: 'elytra',
    name: 'Элитры',
    pitch:
      'Взлетайте и забирайте выигрыш, пока элитры не сломались. Чем дольше полёт, тем выше множитель. Точка слома у каждого полёта своя и скрыта до конца.',
    facts: ['Вывод в любой момент', 'Множитель до 100×', 'Личный полёт'],
    art: [['elytra', 'stone', 'stone', 'stone']],
  },
]

function Row({ entry }: { entry: Entry }) {
  const info = useGameInfo(entry.id)
  return (
    <article className="game-row">
      <div className="game-art" aria-hidden="true">
        {entry.art.map((row, i) => (
          <div key={i} className="art-row">
            {row.map((name, j) => (
              <img key={j} src={dataUrl(name, 6)} alt="" />
            ))}
          </div>
        ))}
      </div>
      <div className="game-body">
        <h2>{entry.name}</h2>
        <p>{entry.pitch}</p>
        <ul className="facts">
          {entry.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
      <div className="game-side">
        <dl>
          <div>
            <dt>Ставка</dt>
            <dd>{info ? `от ${coins(info.min_bet)}` : '—'}</dd>
          </div>
          <div>
            <dt>Выигрыш</dt>
            <dd>{info ? `до ${info.max_win_multiplier}×` : '—'}</dd>
          </div>
          <div>
            <dt>Возврат</dt>
            <dd>{info ? `${Math.round(info.rtp * 1000) / 10}%` : '—'}</dd>
          </div>
        </dl>
        <a className="btn btn-primary" href={`#/${entry.id}`}>
          Играть
        </a>
      </div>
    </article>
  )
}

export default function Lobby() {
  const { user } = useAuth()
  return (
    <>
      <PageHead title="Игры" sub={`${user?.mc_nick}, выбирайте шахту.`} />
      <div className="game-list">
        {GAMES.map((g) => (
          <Row key={g.id} entry={g} />
        ))}
      </div>
      <section className="care" aria-labelledby="care-title">
        <h2 id="care-title">Играйте ответственно</h2>
        <p>
          Игра — это риск потерять монеты, а не способ заработать. Ставьте только то, что готовы потерять, делайте
          перерывы и не пытайтесь отыграться. Возврат 96% — это среднее за миллионы раундов, в одной сессии результат
          может сильно отличаться. Игра только для 18+.
        </p>
      </section>
    </>
  )
}
