<?php
declare(strict_types=1);

$dataFile = __DIR__ . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'projects.json';

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function money(float $value): string
{
    return 'R$ ' . number_format($value, 2, ',', '.');
}

function loadProjects(string $file): array
{
    if (!file_exists($file)) {
        return [];
    }

    $contents = file_get_contents($file);
    $projects = json_decode($contents ?: '[]', true);

    return is_array($projects) ? $projects : [];
}

function saveProjects(string $file, array $projects): void
{
    $dir = dirname($file);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }

    file_put_contents($file, json_encode($projects, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function postArray(string $name): array
{
    $value = $_POST[$name] ?? [];
    return is_array($value) ? array_values(array_map('strval', $value)) : [];
}

function estimateProject(array $project): array
{
    $points = max(0, (int) ($project['work_points'] ?? 0));
    $floors = max(1, (int) ($project['floors'] ?? 1));
    $racks = max(1, (int) ($project['rack_count'] ?? 1));
    $category = (string) ($project['cable_category'] ?? 'Cat6');

    $cablePriceByCategory = [
        'Cat5e' => 5.8,
        'Cat6' => 7.4,
        'Cat6A' => 10.9,
    ];

    $avgMetersPerPoint = 38;
    $cableMeters = $points * $avgMetersPerPoint;
    $cableCost = $cableMeters * ($cablePriceByCategory[$category] ?? $cablePriceByCategory['Cat6']);
    $patchPanelCost = (int) ceil($points / 24) * 590;
    $keystoneCost = $points * 42;
    $patchCordCost = $points * 2 * 28;
    $rackCost = $racks * 2200;
    $pathwayCost = $floors * 1850;
    $fiberCost = !empty($project['fiber_backbone']) ? max(0, $floors - 1) * 1450 : 0;
    $laborCost = $points * 165;

    $items = [
        'Cabos UTP ' . $category => $cableCost,
        'Patch panels' => $patchPanelCost,
        'Tomadas RJ45 e keystones' => $keystoneCost,
        'Patch cords' => $patchCordCost,
        'Racks de telecomunicacoes' => $rackCost,
        'Eletrocalhas, perfilados, canaletas e eletrodutos' => $pathwayCost,
        'Backbone em fibra optica' => $fiberCost,
        'Lancamento, identificacao e certificacao' => $laborCost,
    ];

    return [
        'items' => $items,
        'total' => array_sum($items),
        'cable_meters' => $cableMeters,
    ];
}

function checklistFor(array $project): array
{
    $standards = $project['standards'] ?? [];
    $pathways = $project['pathways'] ?? [];
    $hasFiber = !empty($project['fiber_backbone']);
    $floors = (int) ($project['floors'] ?? 1);

    return [
        [
            'label' => 'Projeto executivo com levantamento de necessidades, layout, pontos de trabalho e sala tecnica.',
            'ok' => trim((string) ($project['technical_room'] ?? '')) !== '' && (int) ($project['work_points'] ?? 0) > 0,
        ],
        [
            'label' => 'Norma NBR 14565 aplicada ao cabeamento estruturado.',
            'ok' => in_array('NBR 14565', $standards, true),
        ],
        [
            'label' => 'Norma NBR 16415 aplicada aos caminhos e espacos.',
            'ok' => in_array('NBR 16415', $standards, true),
        ],
        [
            'label' => 'Separacao fisica entre cabeamento de dados e rede eletrica prevista.',
            'ok' => count($pathways) > 0,
        ],
        [
            'label' => 'Backbone vertical em fibra optica para predios com multiplos pavimentos.',
            'ok' => $floors <= 1 || $hasFiber,
        ],
    ];
}

$projects = loadProjects($dataFile);
$message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $projects[] = [
        'id' => $projects ? max(array_column($projects, 'id')) + 1 : 1,
        'name' => trim((string) ($_POST['name'] ?? 'Novo projeto')),
        'building_type' => (string) ($_POST['building_type'] ?? 'predial'),
        'floors' => max(1, (int) ($_POST['floors'] ?? 1)),
        'technical_room' => trim((string) ($_POST['technical_room'] ?? '')),
        'status' => (string) ($_POST['status'] ?? 'Em planejamento'),
        'standards' => postArray('standards'),
        'work_points' => max(0, (int) ($_POST['work_points'] ?? 0)),
        'rack_count' => max(1, (int) ($_POST['rack_count'] ?? 1)),
        'cable_category' => (string) ($_POST['cable_category'] ?? 'Cat6'),
        'fiber_backbone' => isset($_POST['fiber_backbone']),
        'pathways' => postArray('pathways'),
        'notes' => trim((string) ($_POST['notes'] ?? '')),
        'created_at' => date('Y-m-d H:i:s'),
    ];

    saveProjects($dataFile, $projects);
    $message = 'Projeto cadastrado com sucesso.';
}

$selectedId = isset($_GET['project']) ? (int) $_GET['project'] : (int) ($projects[0]['id'] ?? 0);
$selectedProject = null;
foreach ($projects as $project) {
    if ((int) $project['id'] === $selectedId) {
        $selectedProject = $project;
        break;
    }
}
$selectedProject ??= $projects[0] ?? null;

$totalPoints = array_sum(array_map(static fn (array $project): int => (int) ($project['work_points'] ?? 0), $projects));
$totalRacks = array_sum(array_map(static fn (array $project): int => (int) ($project['rack_count'] ?? 0), $projects));
$fiberProjects = count(array_filter($projects, static fn (array $project): bool => !empty($project['fiber_backbone'])));
$activeView = $_GET['view'] ?? 'dashboard';
$validViews = ['dashboard', 'projects', 'new', 'standards'];
if (!in_array($activeView, $validViews, true)) {
    $activeView = 'dashboard';
}

$standardOptions = ['NBR 14565', 'NBR 16415', 'NBR 16264'];
$pathwayOptions = ['Eletrocalhas', 'Perfilados', 'Canaletas', 'Eletrodutos', 'Racks de Telecomunicacoes', 'SEQ', 'AT'];
$materialGuide = [
    'Cabos de Par Trancado (UTP)' => 'Cat5e, Cat6 ou Cat6A conforme velocidade, distancia e criticidade do ambiente.',
    'Fibra Optica' => 'Indicada para backbone, interligacao vertical entre andares e conexoes de maior distancia.',
    'Patch Panels' => 'Organizam as terminacoes dos pontos de rede dentro do rack.',
    'Tomadas RJ45 (Keystones)' => 'Pontos de acesso para usuarios em paredes, mesas tecnicas ou caixas de piso.',
    'Patch Cords' => 'Ligam equipamento a tomada e patch panel ao switch.',
];
?>
<!doctype html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sistema de Cabeamento Estruturado</title>
    <link rel="stylesheet" href="assets/styles.css">
</head>
<body>
    <div class="app-shell">
        <aside class="sidebar">
            <div class="brand">
                <div class="brand-mark">CE</div>
                <div>
                    <p class="brand-title">InfraPredio</p>
                    <p class="brand-subtitle">Cabeamento estruturado</p>
                </div>
            </div>

            <nav class="nav" aria-label="Navegacao principal">
                <a class="<?= $activeView === 'dashboard' ? 'active' : '' ?>" href="?view=dashboard">Painel</a>
                <a class="<?= $activeView === 'projects' ? 'active' : '' ?>" href="?view=projects">Projetos</a>
                <a class="<?= $activeView === 'new' ? 'active' : '' ?>" href="?view=new">Novo projeto</a>
                <a class="<?= $activeView === 'standards' ? 'active' : '' ?>" href="?view=standards">Normas e materiais</a>
            </nav>
        </aside>

        <main class="content">
            <?php if ($message !== ''): ?>
                <div class="alert"><?= h($message) ?></div>
            <?php endif; ?>

            <?php if ($activeView === 'dashboard'): ?>
                <section class="topbar">
                    <div>
                        <p class="eyebrow">Painel operacional</p>
                        <h1>Gestao de infraestrutura predial</h1>
                        <p class="lead">Controle projetos de cabeamento estruturado, pontos de rede, racks, backbone, caminhos fisicos, normas tecnicas e estimativa inicial de materiais.</p>
                    </div>
                    <a class="button" href="?view=new">Cadastrar projeto</a>
                </section>

                <section class="grid metrics" aria-label="Indicadores">
                    <article class="metric">
                        <p class="metric-value"><?= count($projects) ?></p>
                        <p class="metric-label">Projetos cadastrados</p>
                    </article>
                    <article class="metric">
                        <p class="metric-value"><?= (int) $totalPoints ?></p>
                        <p class="metric-label">Pontos de rede</p>
                    </article>
                    <article class="metric">
                        <p class="metric-value"><?= (int) $totalRacks ?></p>
                        <p class="metric-label">Racks previstos</p>
                    </article>
                    <article class="metric">
                        <p class="metric-value"><?= $fiberProjects ?></p>
                        <p class="metric-label">Projetos com fibra</p>
                    </article>
                </section>

                <section class="layout">
                    <div>
                        <div class="panel">
                            <h2>Projetos recentes</h2>
                            <?php if (!$projects): ?>
                                <p class="empty">Nenhum projeto cadastrado.</p>
                            <?php else: ?>
                                <div class="table-wrap">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Projeto</th>
                                                <th>Status</th>
                                                <th>Pontos</th>
                                                <th>Categoria</th>
                                                <th>Normas</th>
                                                <th></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <?php foreach (array_reverse($projects) as $project): ?>
                                                <tr>
                                                    <td>
                                                        <strong><?= h((string) $project['name']) ?></strong><br>
                                                        <span class="empty"><?= h((string) $project['technical_room']) ?></span>
                                                    </td>
                                                    <td><?= h((string) $project['status']) ?></td>
                                                    <td><?= (int) $project['work_points'] ?></td>
                                                    <td><?= h((string) $project['cable_category']) ?></td>
                                                    <td>
                                                        <div class="badge-list">
                                                            <?php foreach (($project['standards'] ?? []) as $standard): ?>
                                                                <span class="badge"><?= h((string) $standard) ?></span>
                                                            <?php endforeach; ?>
                                                        </div>
                                                    </td>
                                                    <td><a class="button secondary" href="?view=projects&project=<?= (int) $project['id'] ?>">Abrir</a></td>
                                                </tr>
                                            <?php endforeach; ?>
                                        </tbody>
                                    </table>
                                </div>
                            <?php endif; ?>
                        </div>
                    </div>

                    <aside>
                        <div class="panel">
                            <h2>Fluxo tecnico</h2>
                            <div class="timeline">
                                <div class="step">
                                    <div class="step-number">1</div>
                                    <div>
                                        <h3>Planejamento</h3>
                                        <p>Levantamento das necessidades, layout, pontos de trabalho e sala tecnica.</p>
                                    </div>
                                </div>
                                <div class="step">
                                    <div class="step-number">2</div>
                                    <div>
                                        <h3>Caminhos e espacos</h3>
                                        <p>Definicao de eletrocalhas, perfilados, canaletas, eletrodutos, SEQ e AT.</p>
                                    </div>
                                </div>
                                <div class="step">
                                    <div class="step-number">3</div>
                                    <div>
                                        <h3>Materiais passivos</h3>
                                        <p>Dimensionamento de cabos UTP, fibra, patch panels, keystones e patch cords.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </aside>
                </section>
            <?php endif; ?>

            <?php if ($activeView === 'projects'): ?>
                <section class="topbar">
                    <div>
                        <p class="eyebrow">Projetos</p>
                        <h1>Detalhamento tecnico</h1>
                        <p class="lead">Consulte escopo, aderencia as normas e uma estimativa inicial de materiais para cada predio.</p>
                    </div>
                    <a class="button" href="?view=new">Novo projeto</a>
                </section>

                <?php if (!$selectedProject): ?>
                    <div class="panel"><p class="empty">Nenhum projeto cadastrado.</p></div>
                <?php else: ?>
                    <?php $estimate = estimateProject($selectedProject); ?>
                    <section class="layout">
                        <div>
                            <div class="panel">
                                <h2><?= h((string) $selectedProject['name']) ?></h2>
                                <div class="badge-list">
                                    <span class="badge ok"><?= h((string) $selectedProject['status']) ?></span>
                                    <span class="badge"><?= (int) $selectedProject['floors'] ?> pavimentos</span>
                                    <span class="badge"><?= (int) $selectedProject['work_points'] ?> pontos</span>
                                    <span class="badge"><?= h((string) $selectedProject['cable_category']) ?></span>
                                    <?php if (!empty($selectedProject['fiber_backbone'])): ?>
                                        <span class="badge">Backbone fibra optica</span>
                                    <?php endif; ?>
                                </div>
                                <p><strong>Sala tecnica:</strong> <?= h((string) $selectedProject['technical_room']) ?></p>
                                <p><strong>Observacoes:</strong> <?= h((string) $selectedProject['notes']) ?></p>
                            </div>

                            <div class="panel">
                                <h2>Checklist de conformidade</h2>
                                <div class="grid">
                                    <?php foreach (checklistFor($selectedProject) as $item): ?>
                                        <div>
                                            <span class="badge <?= $item['ok'] ? 'ok' : 'warn' ?>"><?= $item['ok'] ? 'OK' : 'Revisar' ?></span>
                                            <?= h($item['label']) ?>
                                        </div>
                                    <?php endforeach; ?>
                                </div>
                            </div>

                            <div class="panel">
                                <h2>Estimativa de materiais e servico</h2>
                                <div class="table-wrap">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Item</th>
                                                <th>Valor estimado</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <?php foreach ($estimate['items'] as $item => $value): ?>
                                                <tr>
                                                    <td><?= h((string) $item) ?></td>
                                                    <td><?= money((float) $value) ?></td>
                                                </tr>
                                            <?php endforeach; ?>
                                        </tbody>
                                    </table>
                                </div>
                                <div class="total-box">
                                    <p>Total estimado</p>
                                    <strong><?= money((float) $estimate['total']) ?></strong>
                                </div>
                            </div>
                        </div>

                        <aside>
                            <div class="panel">
                                <h2>Selecionar projeto</h2>
                                <div class="grid">
                                    <?php foreach ($projects as $project): ?>
                                        <a class="button secondary" href="?view=projects&project=<?= (int) $project['id'] ?>"><?= h((string) $project['name']) ?></a>
                                    <?php endforeach; ?>
                                </div>
                            </div>

                            <div class="panel">
                                <h2>Caminhos previstos</h2>
                                <div class="badge-list">
                                    <?php foreach (($selectedProject['pathways'] ?? []) as $pathway): ?>
                                        <span class="badge"><?= h((string) $pathway) ?></span>
                                    <?php endforeach; ?>
                                </div>
                            </div>
                        </aside>
                    </section>
                <?php endif; ?>
            <?php endif; ?>

            <?php if ($activeView === 'new'): ?>
                <section class="topbar">
                    <div>
                        <p class="eyebrow">Cadastro</p>
                        <h1>Novo projeto de cabeamento</h1>
                        <p class="lead">Registre os dados principais do projeto executivo, infraestrutura fisica, materiais passivos e normas aplicaveis.</p>
                    </div>
                </section>

                <form class="panel" method="post" action="?view=projects">
                    <div class="form-grid">
                        <label>
                            Nome do projeto
                            <input name="name" required placeholder="Ex.: Edificio Administrativo Central">
                        </label>
                        <label>
                            Tipo de predio
                            <select name="building_type">
                                <option value="predial">Predial corporativo</option>
                                <option value="residencial">Residencial</option>
                                <option value="misto">Misto</option>
                                <option value="industrial">Industrial</option>
                            </select>
                        </label>
                        <label>
                            Pavimentos
                            <input type="number" name="floors" min="1" value="1" required>
                        </label>
                        <label>
                            Pontos de rede
                            <input type="number" name="work_points" min="0" value="24" required>
                        </label>
                        <label>
                            Racks de telecomunicacoes
                            <input type="number" name="rack_count" min="1" value="1" required>
                        </label>
                        <label>
                            Categoria do cabo UTP
                            <select name="cable_category">
                                <option>Cat5e</option>
                                <option selected>Cat6</option>
                                <option>Cat6A</option>
                            </select>
                        </label>
                        <label>
                            Sala tecnica / SEQ / AT
                            <input name="technical_room" required placeholder="Ex.: SEQ no terreo e AT por pavimento">
                        </label>
                        <label>
                            Status
                            <select name="status">
                                <option>Em planejamento</option>
                                <option>Em execucao</option>
                                <option>Aguardando materiais</option>
                                <option>Concluido</option>
                            </select>
                        </label>

                        <div class="full">
                            <label>Normas tecnicas</label>
                            <div class="check-grid">
                                <?php foreach ($standardOptions as $standard): ?>
                                    <label class="check">
                                        <input type="checkbox" name="standards[]" value="<?= h($standard) ?>" <?= $standard !== 'NBR 16264' ? 'checked' : '' ?>>
                                        <?= h($standard) ?>
                                    </label>
                                <?php endforeach; ?>
                            </div>
                        </div>

                        <div class="full">
                            <label>Caminhos e espacos</label>
                            <div class="check-grid">
                                <?php foreach ($pathwayOptions as $pathway): ?>
                                    <label class="check">
                                        <input type="checkbox" name="pathways[]" value="<?= h($pathway) ?>" <?= in_array($pathway, ['Eletrocalhas', 'Eletrodutos', 'Racks de Telecomunicacoes'], true) ? 'checked' : '' ?>>
                                        <?= h($pathway) ?>
                                    </label>
                                <?php endforeach; ?>
                            </div>
                        </div>

                        <label class="check full">
                            <input type="checkbox" name="fiber_backbone" checked>
                            Utilizar fibra optica no backbone vertical entre pavimentos
                        </label>

                        <label class="full">
                            Observacoes tecnicas
                            <textarea name="notes" placeholder="Ex.: Separar dados da rede eletrica e prever identificacao em todos os pontos."></textarea>
                        </label>
                    </div>

                    <div class="actions">
                        <button type="submit">Salvar projeto</button>
                        <a class="button secondary" href="?view=dashboard">Cancelar</a>
                    </div>
                </form>
            <?php endif; ?>

            <?php if ($activeView === 'standards'): ?>
                <section class="topbar">
                    <div>
                        <p class="eyebrow">Base tecnica</p>
                        <h1>Normas, infraestrutura e materiais</h1>
                        <p class="lead">Resumo operacional para orientar projetos de cabeamento estruturado em predios.</p>
                    </div>
                </section>

                <section class="layout">
                    <div>
                        <div class="panel">
                            <h2>Planejamento e normas tecnicas</h2>
                            <div class="timeline">
                                <div class="step">
                                    <div class="step-number">PE</div>
                                    <div>
                                        <h3>Projeto executivo</h3>
                                        <p>Levantamento de necessidades, definicao do layout, pontos de rede de trabalho e localizacao da sala tecnica.</p>
                                    </div>
                                </div>
                                <div class="step">
                                    <div class="step-number">AB</div>
                                    <div>
                                        <h3>Normas ABNT</h3>
                                        <p>NBR 14565 para cabeamento estruturado, NBR 16415 para caminhos e espacos e NBR 16264 quando o escopo for residencial.</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="panel">
                            <h2>Infraestrutura fisica</h2>
                            <div class="material-list">
                                <div class="material-item">
                                    <strong>Eletrocalhas, perfilados e canaletas</strong>
                                    Encaminhamento dos cabos em tetos ou paredes, mantendo organizacao e acesso para manutencao.
                                </div>
                                <div class="material-item">
                                    <strong>Eletrodutos</strong>
                                    Tubulacoes embutidas para descida dos cabos ate tomadas e caixas de piso.
                                </div>
                                <div class="material-item">
                                    <strong>Racks, SEQ e AT</strong>
                                    Centralizam equipamentos, patch panels e conexoes em espacos dedicados por predio ou pavimento.
                                </div>
                            </div>
                        </div>
                    </div>

                    <aside>
                        <div class="panel">
                            <h2>Materiais passivos</h2>
                            <div class="material-list">
                                <?php foreach ($materialGuide as $material => $description): ?>
                                    <div class="material-item">
                                        <strong><?= h($material) ?></strong>
                                        <?= h($description) ?>
                                    </div>
                                <?php endforeach; ?>
                            </div>
                        </div>
                    </aside>
                </section>
            <?php endif; ?>
        </main>
    </div>
</body>
</html>
