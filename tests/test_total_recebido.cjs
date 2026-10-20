'use strict';
// Testa as funções originais da tela sem depender de navegador nem de banco externo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'..','static','app.js'),'utf8');
const begin = source.indexOf('function filtrarClientesNoControle(');
const end = source.indexOf('function abrirFinanceiroCliente(',begin);
assert(begin>=0 && end>begin);
const nodes = {};
const values = { buscaCliente:'',clienteFiltroStatus:'',clienteFiltroTipo:'',clientePrevisaoDe:'',clientePrevisaoAte:''};
function node(id){
  if(!nodes[id])nodes[id]={
    get value(){return values[id]??''},set value(v){values[id]=v},
    textContent:'',innerHTML:'',className:''
  };
  return nodes[id];
}
const context = {
  clientes:[
    {id:1,nome:'Devedor Parcial',tipo_pessoa:'PF',cpf_cnpj:'',telefone:'',whatsapp:'',email:'',saldo:60,total_pago:30,divida:100,total_desconto:10,previsao:'2026-10-19',status:'ATRASADO'},
    {id:2,nome:'Cliente Quitado',tipo_pessoa:'PF',cpf_cnpj:'',telefone:'',whatsapp:'',email:'',saldo:0,total_pago:75,divida:100,total_desconto:25,previsao:'2026-10-30',status:'QUITADO'},
    {id:3,nome:'Sem Pagamentos',tipo_pessoa:'PJ',cpf_cnpj:'',telefone:'',whatsapp:'',email:'',saldo:50,total_pago:0,divida:50,total_desconto:0,previsao:'2026-10-30',status:'EM ABERTO'},
  ],
  pagamentos:[],document:{getElementById:node},paginaClientes:1,LINHAS_TABELA:5,
  moeda:x=>Number(x).toFixed(2),dataBR:x=>x||'-',statusClass:x=>x,escaparFinanceiro:x=>x,
  renderPaginacaoTabela:()=>{},mudarPaginaClientes:()=>{}
};
vm.createContext(context);
vm.runInContext(source.slice(begin,end),context);
function render(){vm.runInContext('renderClientes()',context);return [node('clientesTotalReceber').textContent,node('clientesTotalRecebido').textContent];}
assert.deepEqual(render(),['110.00','105.00'],'Na lista padrão o recebido inclui clientes quitados e não inclui descontos.');
assert.equal(context.clientesFiltrados().length,2,'Quitados não reaparecem como bloqueados.');
assert.match(node('clientesTotaisAviso').textContent,/inclusive de clientes quitados/);
values.clienteFiltroStatus='QUITADO';
assert.deepEqual(render(),['0.00','75.00'],'O filtro de quitados mostra apenas o seu histórico.');
values.clienteFiltroStatus='COM_PAGAMENTOS';
assert.deepEqual(render(),['60.00','105.00'],'Recebidos reúne devedores e quitados que pagaram.');
values.clienteFiltroStatus='DEVEDOR';
assert.deepEqual(render(),['110.00','30.00'],'A receber explícito não inclui clientes quitados.');
values.clienteFiltroStatus='ATRASADO';
assert.deepEqual(render(),['60.00','30.00'],'Um filtro de situação específica limita os totais.');
values.clienteFiltroStatus='';values.clienteFiltroTipo='PJ';
assert.deepEqual(render(),['50.00','0.00'],'Tipo de pessoa respeitado.');
values.clienteFiltroTipo='';values.buscaCliente='quitado';
assert.deepEqual(render(),['0.00','75.00'],'Busca encontra pagamentos quitados, sem torná-los bloqueados.');
values.buscaCliente='';values.clientePrevisaoDe='2026-10-20';
assert.deepEqual(render(),['50.00','75.00'],'Filtro de previsão mantido nas duas somas.');
values.clientePrevisaoDe='';values.clientePrevisaoAte='';
context.clientes[1].saldo=20;context.clientes[1].status='EM ABERTO';context.clientes[1].total_pago=55;
assert.deepEqual(render(),['130.00','85.00'],'Após reversão o cliente volta a ser bloqueado e o recebido diminui.');
console.log('OK: 9 verificações de totais, filtros, quitação e reversão.');
