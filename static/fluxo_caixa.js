const fluxoEstado={dados:null,consulta:0,dias:1,mov:1,pendencias:1};
const fluxoNomes={clientes:'Clientes bloqueados',orgaos:'Órgãos públicos',manual:'Entrada manual Saci',arcm:'Receitas ARCM',despesas:'Despesas Gerais'};
const fluxoEl=id=>document.getElementById(id);
function fluxoPagina(tipo,rows,body,colunas,render){
  fluxoEstado[tipo]=Math.min(fluxoEstado[tipo],Math.max(1,Math.ceil(rows.length/5)));
  fluxoEl(body).innerHTML=rows.slice((fluxoEstado[tipo]-1)*5,fluxoEstado[tipo]*5).map(render).join('')||`<tr><td colspan="${colunas}" class="empty">Nenhuma movimentação neste período.</td></tr>`;
  renderPaginacaoTabela('fluxo-'+tipo,fluxoEstado[tipo],rows.length,n=>{fluxoEstado[tipo]=n;fluxoRender()});
}
function fluxoRender(){
  const d=fluxoEstado.dados;if(!d)return;
  fluxoPagina('dias',[...d.dias].reverse(),'fluxoDiasBody',5,r=>`<tr><td>${dataBR(r.data)}</td><td class="fluxo-entrada">${moeda(r.entradas)}</td><td class="fluxo-saida">${moeda(r.saidas)}</td><td>${moeda(r.saldo)}</td><td><strong>${moeda(r.acumulado)}</strong></td></tr>`);
  const dia=fluxoEl('fluxoDia').value,origem=fluxoEl('fluxoOrigem').value;
  const rows=d.registros.filter(r=>(!dia||r.data===dia)&&(!origem||r.origem===origem)).reverse();
  fluxoPagina('mov',rows,'fluxoMovBody',6,r=>`<tr><td>${dataBR(r.data)}</td><td>${fluxoNomes[r.origem]}${r.categoria?`<div class="table-sub">${escaparFinanceiro(r.categoria)}</div>`:''}</td><td>${escaparFinanceiro(r.descricao)}${r.documento?`<div class="table-sub">${escaparFinanceiro(r.documento)}</div>`:''}</td><td>${r.tipo==='entrada'?'Entrada':'Saída'}</td><td class="fluxo-${r.tipo}">${moeda(r.valor)}</td><td>${escaparFinanceiro(r.forma_pagamento||'Não informada')}</td></tr>`);
  const pend=d.orgaos_sem_data;
  fluxoEl('fluxoPendencias').classList.toggle('hidden',!pend.length);
  fluxoEl('fluxoPendenciasTitulo').textContent=`${pend.length} recebimento(s) de órgãos sem data — fora dos totais`;
  fluxoPagina('pendencias',pend,'fluxoPendenciasBody',4,r=>`<tr><td>${escaparFinanceiro(r.nome_orgao)}</td><td>${escaparFinanceiro(r.numero_nota_fiscal)}</td><td>${moeda(r.valor)}</td><td><button type="button" class="secondary" data-fluxo-data="${r.id}">Informar data</button></td></tr>`);
  fluxoEl('fluxoPendenciasBody').querySelectorAll('[data-fluxo-data]').forEach(b=>b.addEventListener('click',async()=>{
    const data_recebimento=prompt('Data real do recebimento (AAAA-MM-DD):','');if(data_recebimento===null)return;
    b.disabled=true;
    try{await api('/api/orgaos-publicos/'+b.dataset.fluxoData+'/status',{method:'PATCH',body:JSON.stringify({pago:true,data_recebimento})});await fluxoCarregar();await carregarOrgaosPublicos();msg('Data do recebimento registrada.')}catch(e){msg(e.message,'erro')}finally{b.disabled=false}
  }));
}
async function fluxoCarregar(){
  const consulta=++fluxoEstado.consulta,mes=fluxoEl('fluxoMes').value;if(!mes)return;
  fluxoEl('fluxoAviso').textContent='Atualizando o fluxo de caixa…';
  try{
    const d=await api('/api/fluxo-caixa/geral?'+new URLSearchParams({mes}));if(consulta!==fluxoEstado.consulta)return;
    fluxoEstado.dados=d;
    for(const [id,k] of Object.entries({fluxoEntradas:'entradas',fluxoSaidas:'saidas',fluxoResultado:'resultado',fluxoFinal:'saldo_final'}))fluxoEl(id).textContent=moeda(d.resumo[k]);
    fluxoEl('fluxoAnterior').textContent='Saldo anterior registrado: '+moeda(d.resumo.saldo_anterior);
    fluxoEl('fluxoOrigens').textContent=`Entradas: clientes bloqueados ${moeda(d.resumo.origens.clientes)} · Órgãos públicos ${moeda(d.resumo.origens.orgaos)} · Manuais Saci ${moeda(d.resumo.origens.manual)} · ARCM ${moeda(d.resumo.origens.arcm)}`;
    fluxoEl('fluxoAviso').textContent=`${d.registros.length} movimentação(ões) no mês · Integração automática com os controles de origem.`;
    fluxoRender();
  }catch(e){if(consulta!==fluxoEstado.consulta)return;fluxoEstado.dados=null;for(const id of ['fluxoEntradas','fluxoSaidas','fluxoResultado','fluxoFinal','fluxoAnterior'])fluxoEl(id).textContent='—';for(const id of ['fluxoDiasBody','fluxoMovBody','fluxoPendenciasBody','fluxoOrigens'])fluxoEl(id).textContent='';for(const tipo of ['dias','mov','pendencias']){fluxoEl('fluxo-'+tipo+'PaginaResumo').textContent='';fluxoEl('fluxo-'+tipo+'Paginas').textContent=''}fluxoEl('fluxoPendencias').classList.add('hidden');fluxoEl('fluxoAviso').textContent='Não foi possível atualizar: '+e.message}
}
fluxoEl('fluxoMes').value=recHoje().slice(0,7);
fluxoEl('fluxoMes').addEventListener('change',()=>{fluxoEstado.dias=fluxoEstado.mov=1;fluxoEl('fluxoDia').value='';fluxoCarregar()});
fluxoEl('fluxoAtualizar').addEventListener('click',fluxoCarregar);
for(const id of ['fluxoDia','fluxoOrigem'])fluxoEl(id).addEventListener('change',()=>{fluxoEstado.mov=1;fluxoRender()});
