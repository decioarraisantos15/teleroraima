# Sistema PHP de Cabeamento Estruturado

Aplicacao simples em PHP para cadastro e acompanhamento de projetos de cabeamento estruturado em infraestrutura predial.

## Funcionalidades

- Painel com indicadores de projetos, pontos de rede, racks e backbone em fibra.
- Cadastro de projeto executivo com pavimentos, pontos de trabalho, sala tecnica, categoria do cabo e status.
- Selecao de normas ABNT: NBR 14565, NBR 16415 e NBR 16264.
- Registro de caminhos e espacos: eletrocalhas, perfilados, canaletas, eletrodutos, racks, SEQ e AT.
- Checklist de conformidade tecnica.
- Estimativa inicial de materiais passivos e servico.
- Persistencia local em `data/projects.json`, sem banco de dados.

## Como executar

Com PHP instalado:

```powershell
php -S localhost:8000
```

Depois acesse:

```text
http://localhost:8000
```

Tambem pode ser usado em XAMPP, WAMP ou Laragon copiando esta pasta para o diretorio publico do servidor.

## Arquivos principais

- `index.php`: aplicacao PHP.
- `assets/styles.css`: estilos da interface.
- `data/projects.json`: dados dos projetos.
