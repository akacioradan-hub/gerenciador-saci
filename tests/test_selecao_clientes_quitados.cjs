'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','static','app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','templates','index.html'),'utf8');
const nodes=new Map();
function elem(id){
  if(!nodes.has(id))nodes.set(id,{
    id, value:'', innerHTML:'', textContent:'', disabled:false, dataset:{}, open:false,
    addEventListener(){}, showModal(){this.open=true},close(){this.open=false},scrollIntoView(){}
  });
  return nodes.get(id);
}
const c1={id:1,nome:'Cliente Devendo',saldo:50,divida:100,total_pago:50,total_desconto:0,previsao:'2026-11-10'};
const c2={id:2,nome:'Cliente Quitado',saldo:0,divida:100,total_pago:80,total_desconto:20,previsao:'2026-10-25'};
const c3={id:3,nome:'Quitado com Desconto',saldo:0,divida:40,total_pago:0,total_desconto:40,previsao:'2026-10-25'};
const ctx={
  clientes:[c1,c2,c3], pagamentos:[
    {id:40,cliente_id:1,data:'2026-10-20',valor:50,desconto:0},
    {id:41,cliente_id:2,data:'2026-10-22',valor:80,desconto:20,observacao:'Pagamento final'},
    {id:42,cliente_id:3,data:'2026-10-22',valor:0,desconto:40,observacao:'Abatimento final'}
  ],
  document:{getElementById:elem,querySelectorAll:()=>[]},
  moeda:n=>Number(n||0).toFixed(2),dataBR:d=>d||'-',escaparFinanceiro:v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
  atualizarResumoPagamento:()=>{},console
};
vm.createContext(ctx);
const start=src.indexOf('function preencherClientes(');
const end=src.indexOf('async function carregarClientes(',start);
assert(start>=0&&end>start);
vm.runInContext(src.slice(start,end),ctx);
const hs=src.indexOf('// O histórico de clientes quitados');
const he=src.indexOf('async function atualizarTudo()',hs);
assert(hs>=0&&he>hs);
vm.runInContext(src.slice(hs,he),ctx);
let n=0;
const check=(fn,message)=>{fn();n++;};
const select=elem('pagCliente');
vm.runInContext('preencherClientes()',ctx);
check(()=>{assert.match(select.innerHTML,/Cliente Devendo/);assert.doesNotMatch(select.innerHTML,/Cliente Quitado/);assert.doesNotMatch(select.innerHTML,/Quitado com Desconto/)},'Ocultar todos os quitados');
check(()=>{assert.equal(select.value,'');assert.match(elem('pagamentosBody').innerHTML,/Selecione um cliente/)},'Sem seleção inicial');
select.value='1';vm.runInContext('preencherClientes()',ctx);
check(()=>assert.equal(select.value,'1'),'Preservar devedor selecionado');
check(()=>assert.match(elem('pagamentosBody').innerHTML,/2026-10-20/), 'Histórico de devedor permitido');
c1.saldo=0;c1.total_pago=100;vm.runInContext('preencherClientes()',ctx);
check(()=>{assert.equal(select.value,'');assert.doesNotMatch(select.innerHTML,/Cliente Devendo/)},'Após quitação, limpar seleção e remover cliente');
vm.runInContext('verHistoricoCliente(2)',ctx);
check(()=>{assert.equal(elem('clienteHistoricoModal').open,true);assert.equal(elem('clienteHistoricoNome').textContent,'Cliente Quitado');assert.match(elem('clienteHistoricoBody').innerHTML,/Pagamento final/);assert.match(elem('clienteHistoricoBody').innerHTML,/excluirPagamento\(41\)/)},'Histórico de quitado acessível com edição e reversão');
vm.runInContext('verHistoricoCliente(3)',ctx);
check(()=>assert.match(elem('clienteHistoricoBody').innerHTML,/Abatimento final/),'Desconto total também preserva histórico');
c2.saldo=35;c2.total_pago=45;vm.runInContext('preencherClientes(); selecionarClienteSeDevedor(2)',ctx);
check(()=>{assert.equal(select.value,'2');assert.match(select.innerHTML,/Cliente Quitado/)},'Após reversão, cliente volta à seleção');
c2.saldo=0;c2.total_pago=80;vm.runInContext('preencherClientes(); selecionarClienteSeDevedor(2)',ctx);
check(()=>assert.equal(select.value,''),'Não ressuscitar quitado ao restaurar seleção');
check(()=>{assert.match(html,/id="clienteHistoricoModal"/);assert.match(html,/id="clienteHistoricoBody"/)},'Modal de histórico incluído no HTML');
assert.match(src,/onclick="verHistoricoCliente\(\$\{c.id\}\)"/);
assert.match(html,/v=20261031-ocultar-quitados-selecao/);
console.log(`OK: ${n} cenários de seleção, quitação, histórico e reversão.`);
