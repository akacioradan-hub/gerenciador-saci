const arcmFluxo={dados:null,consulta:0,dias:1,mov:1};
const arcmFluxoEl=id=>document.getElementById(id);
function arcmFluxoPagina(tipo,rows,body,colunas,render){
 arcmFluxo[tipo]=Math.min(arcmFluxo[tipo],Math.max(1,Math.ceil(rows.length/5)));
 arcmFluxoEl(body).innerHTML=rows.slice((arcmFluxo[tipo]-1)*5,arcmFluxo[tipo]*5).map(render).join('')||`<tr><td colspan="${colunas}" class="empty">Nenhum recebimento neste período.</td></tr>`;
 renderPaginacaoTabela('arcm-fluxo-'+tipo,arcmFluxo[tipo],rows.length,n=>{arcmFluxo[tipo]=n;arcmFluxoRender()});
}
function arcmFluxoRender(){
 const d=arcmFluxo.dados;if(!d)return;
 arcmFluxoPagina('dias',[...d.dias].reverse(),'arcmFluxoDiasBody',3,r=>`<tr><td>${dataBR(r.data)}</td><td class="fluxo-entrada">${moeda(r.entradas)}</td><td>${moeda(r.acumulado)}</td></tr>`);
 const dia=arcmFluxoEl('arcmFluxoDia').value,cliente=arcmFluxoEl('arcmFluxoCliente').value;
 const rows=d.registros.filter(r=>(!dia||r.data===dia)&&(!cliente||String(r.cliente_id)===cliente)).reverse();
 arcmFluxoPagina('mov',rows,'arcmFluxoMovBody',5,r=>`<tr><td>${dataBR(r.data)}</td><td>${escaparFinanceiro(r.cliente_nome||'Sem cliente')}</td><td>${escaparFinanceiro(r.descricao)}${r.numero_contrato?`<div class="table-sub">Contrato ${escaparFinanceiro(r.numero_contrato)} · Parcela ${r.parcela||'—'}</div>`:''}${r.documento?`<div class="table-sub">${escaparFinanceiro(r.documento)}</div>`:''}</td><td class="fluxo-entrada">${moeda(r.valor)}</td><td>${escaparFinanceiro(r.forma_pagamento||'Não informada')}</td></tr>`);
}
async function fluxoArcmCarregar(){
 const consulta=++arcmFluxo.consulta,mes=arcmFluxoEl('arcmFluxoMes').value;if(!mes)return;
 arcmFluxoEl('arcmFluxoAviso').textContent='Atualizando recebimentos…';
 try{
  const d=await api('/api/fluxo-caixa/arcm?'+new URLSearchParams({mes}));if(consulta!==arcmFluxo.consulta)return;
  arcmFluxo.dados=d;
  for(const [id,k] of Object.entries({arcmFluxoTotal:'entradas',arcmFluxoAnterior:'saldo_anterior',arcmFluxoAcumulado:'saldo_final'}))arcmFluxoEl(id).textContent=moeda(d.resumo[k]);
  const select=arcmFluxoEl('arcmFluxoCliente'),valor=select.value;
  const clientes=[...new Map(d.registros.filter(r=>r.cliente_id).map(r=>[String(r.cliente_id),r.cliente_nome])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'pt-BR'));
  select.innerHTML='<option value="">Todos</option>'+clientes.map(([id,nome])=>`<option value="${Number(id)}">${escaparFinanceiro(nome)}</option>`).join('');
  select.value=clientes.some(([id])=>id===valor)?valor:'';
  arcmFluxoEl('arcmFluxoAviso').textContent=`${d.registros.length} recebimento(s) no mês · Integração automática com Receitas ARCM.`;
  arcmFluxoRender();
 }catch(e){if(consulta!==arcmFluxo.consulta)return;arcmFluxo.dados=null;for(const id of ['arcmFluxoTotal','arcmFluxoAnterior','arcmFluxoAcumulado'])arcmFluxoEl(id).textContent='—';for(const id of ['arcmFluxoDiasBody','arcmFluxoMovBody'])arcmFluxoEl(id).textContent='';for(const tipo of ['dias','mov']){arcmFluxoEl('arcm-fluxo-'+tipo+'PaginaResumo').textContent='';arcmFluxoEl('arcm-fluxo-'+tipo+'Paginas').textContent=''}arcmFluxoEl('arcmFluxoAviso').textContent='Não foi possível atualizar: '+e.message}
}
arcmFluxoEl('arcmFluxoMes').value=recHoje().slice(0,7);
arcmFluxoEl('arcmFluxoMes').addEventListener('change',()=>{arcmFluxo.dias=arcmFluxo.mov=1;arcmFluxoEl('arcmFluxoDia').value='';fluxoArcmCarregar()});
arcmFluxoEl('arcmFluxoAtualizar').addEventListener('click',fluxoArcmCarregar);
for(const id of ['arcmFluxoDia','arcmFluxoCliente'])arcmFluxoEl(id).addEventListener('change',()=>{arcmFluxo.mov=1;arcmFluxoRender()});
document.querySelector('[data-tab="fluxo-arcm"]').addEventListener('click',fluxoArcmCarregar);
arcmFluxoEl('arcmFluxoReceitas').addEventListener('click',()=>document.querySelector('[data-tab="receitas-arcm"]').click());
