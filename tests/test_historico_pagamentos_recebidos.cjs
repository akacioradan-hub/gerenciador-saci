'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','static','app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','templates','index.html'),'utf8');
const ids=['historicoPagBusca','historicoPagDe','historicoPagAte','historicoPagBody','historicoPagResumo','historicoPagTotal','historicoPagPaginaResumo','historicoPagPaginas','historicoPagLimpar'];
for(const id of ids)assert.match(html,new RegExp('id="'+id+'"'),'Campo presente: '+id);
assert.match(html,/Histórico de pagamentos recebidos/);
assert.match(html,/v=20261104-historico-pagamentos/);
const inputs={};
for(const id of ids)inputs[id]={value:'',innerHTML:'',textContent:''};
const pagamentos=[
  {id:1,cliente_id:1,cliente_nome:'Devedor',data:'2026-10-01',valor:10.1,desconto:0,observacao:'Primeiro'},
  {id:2,cliente_id:2,cliente_nome:'Quitado & Cia',data:'2026-11-04',valor:0.2,desconto:25,observacao:'Último <pagamento>'},
  {id:3,cliente_id:3,cliente_nome:'Só desconto',data:'2026-11-03',valor:0,desconto:100,observacao:'Abatimento'},
  {id:4,cliente_id:2,cliente_nome:'Quitado & Cia',data:'2026-11-02',valor:0.1,desconto:0,observacao:'Parcial'},
  {id:5,cliente_id:4,cliente_nome:'Outro cliente',data:'2026-11-02',valor:50,desconto:0},
  {id:6,cliente_id:5,cliente_nome:'Cliente 5',data:'2026-10-05',valor:1,desconto:0},
  {id:7,cliente_id:6,cliente_nome:'Cliente 6',data:'2026-10-05',valor:2,desconto:0},
  {id:8,cliente_id:7,cliente_nome:'Cliente 7',data:'2026-10-05',valor:3,desconto:0},
];
const ctx={pagamentos,document:{getElementById:id=>inputs[id]},
  moeda:x=>Number(x).toFixed(2),dataBR:d=>d,
  escaparFinanceiro:x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
  renderPaginacaoTabela:(prefix,pagina,total)=>{ctx.pagination={prefix,pagina,total}},
  console};
vm.createContext(ctx);
vm.runInContext('let paginaHistoricoPagamentos=1;const LINHAS_TABELA=5;',ctx);
const start=src.indexOf('// Histórico geral de recebimentos:');
const end=src.indexOf('async function carregarClientes()',start);
assert(start>0&&end>start);
vm.runInContext(src.slice(start,end),ctx);
const run=code=>vm.runInContext(code,ctx);
const el=id=>inputs[id];
run('renderHistoricoPagamentosRecebidos()');
assert.equal(el('historicoPagTotal').textContent,'66.40','Soma sem desconto, com centavos íntegros');
assert.match(el('historicoPagResumo').textContent,/7 pagamento/,'Exclui desconto puro');
assert.match(el('historicoPagBody').innerHTML,/Quitado &amp; Cia/,'Mostra quitado e escapa o nome');
assert.match(el('historicoPagBody').innerHTML,/&lt;pagamento&gt;/,'Escapa observação');
assert.doesNotMatch(el('historicoPagBody').innerHTML,/Só desconto/,'Descontos sem dinheiro não são recebimentos');
assert.equal(ctx.pagination.total,7);
run('mudarPaginaHistoricoPagamentos(2)');
assert.equal(ctx.pagination.pagina,2);
assert.match(el('historicoPagBody').innerHTML,/Devedor/,'Paginação mostra demais pagamentos');
el('historicoPagBusca').value='QUITADO';run('atualizarFiltrosHistoricoPagamentos()');
assert.equal(el('historicoPagTotal').textContent,'0.30');
assert.equal(ctx.pagination.pagina,1);
assert.match(el('historicoPagBody').innerHTML,/Quitado &amp; Cia/);
assert.doesNotMatch(el('historicoPagBody').innerHTML,/Devedor/);
el('historicoPagDe').value='2026-11-03';run('atualizarFiltrosHistoricoPagamentos()');
assert.equal(el('historicoPagTotal').textContent,'0.20');
el('historicoPagAte').value='2026-11-01';run('atualizarFiltrosHistoricoPagamentos()');
assert.equal(el('historicoPagTotal').textContent,'0.00');
assert.match(el('historicoPagResumo').textContent,/data inicial/);
assert.match(el('historicoPagBody').innerHTML,/Corrija o período/);
// Correção de pagamento e reversão atualizam a fonte de dados do painel.
el('historicoPagDe').value='';el('historicoPagAte').value='';el('historicoPagBusca').value='';
pagamentos[1].valor=0.3;
run('atualizarFiltrosHistoricoPagamentos()');
assert.equal(el('historicoPagTotal').textContent,'66.50');
pagamentos.splice(1,1);
run('renderHistoricoPagamentosRecebidos()');
assert.equal(el('historicoPagTotal').textContent,'66.20');
assert.match(src,/async function carregarPagamentos\(\).*renderHistoricoPagamentosRecebidos\(\)/);
assert.match(src,/id=>document.getElementById\(id\)\?\.addEventListener\('change',atualizarFiltrosHistoricoPagamentos\)/);
console.log('OK: histórico geral, quitação, descontos, soma, filtros, paginação, edição, reversão e segurança de HTML.');
