const arcmFluxo={dados:null,consulta:0,dias:1};
const arcmFluxoEl=id=>document.getElementById(id);
function arcmFluxoRender(){
 if(!arcmFluxo.dados)return;
 const rows=[...arcmFluxo.dados.dias].reverse();
 arcmFluxo.dias=Math.min(arcmFluxo.dias,Math.max(1,Math.ceil(rows.length/5)));
 arcmFluxoEl('arcmFluxoDiasBody').innerHTML=rows.slice((arcmFluxo.dias-1)*5,arcmFluxo.dias*5).map(r=>`<tr><td>${dataBR(r.data)}</td><td class="fluxo-entrada">${moeda(r.entradas)}</td><td>${moeda(r.acumulado)}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">Nenhum recebimento neste mês.</td></tr>';
 renderPaginacaoTabela('arcm-fluxo-dias',arcmFluxo.dias,rows.length,n=>{arcmFluxo.dias=n;arcmFluxoRender()});
}
async function fluxoArcmCarregar(){
 const consulta=++arcmFluxo.consulta,mes=arcmFluxoEl('rec-arcm-mes').value;if(!mes)return;
 arcmFluxoEl('arcmFluxoAviso').textContent='Atualizando recebimentos…';
 try{
  const d=await api('/api/fluxo-caixa/arcm?'+new URLSearchParams({mes}));if(consulta!==arcmFluxo.consulta)return;
  if(arcmFluxo.dados?.mes!==mes)arcmFluxo.dias=1;
  arcmFluxo.dados=d;
  for(const [id,k] of Object.entries({arcmFluxoTotal:'entradas',arcmFluxoAnterior:'saldo_anterior',arcmFluxoAcumulado:'saldo_final'}))arcmFluxoEl(id).textContent=moeda(d.resumo[k]);
  arcmFluxoEl('arcmFluxoAviso').textContent=`${d.registros.length} recebimento(s) no mês. Os valores em aberto ainda não movimentam o caixa.`;
  arcmFluxoRender();
 }catch(e){if(consulta!==arcmFluxo.consulta)return;arcmFluxo.dados=null;for(const id of ['arcmFluxoTotal','arcmFluxoAnterior','arcmFluxoAcumulado'])arcmFluxoEl(id).textContent='—';arcmFluxoEl('arcmFluxoDiasBody').textContent='';for(const id of ['arcm-fluxo-diasPaginaResumo','arcm-fluxo-diasPaginas'])arcmFluxoEl(id).textContent='';arcmFluxoEl('arcmFluxoAviso').textContent='Não foi possível atualizar: '+e.message}
}
arcmFluxoEl('arcmFluxoAtualizar').addEventListener('click',()=>recCarregar('arcm'));
