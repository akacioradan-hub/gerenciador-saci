let contratoEmEdicao=null,contratoSalvando=false;
recEl('recEditarContrato').addEventListener('click',()=>{
 const r=recEstados.arcm.registros.find(r=>r.id===Number(recEl('recId').value));if(!r?.contrato)return;
 contratoEmEdicao=JSON.parse(JSON.stringify(r.contrato));
 for(const [id,k] of Object.entries({Numero:'numero',Tipo:'tipo_pagamento',Prazo:'prazo_meses',Inicio:'inicio',Vencimento:'primeiro_vencimento',Valor:'valor_parcela'}))recEl('contratoEdicao'+id).value=contratoEmEdicao[k];
 recEl('contratoEdicaoErro').textContent='';recEl('contratoEdicaoModal').showModal();recEl('contratoEdicaoNumero').focus();
});
function fecharEdicaoContrato(){if(!contratoSalvando)recEl('contratoEdicaoModal').close()}
recEl('contratoEdicaoCancelar').addEventListener('click',fecharEdicaoContrato);
recEl('contratoEdicaoFechar').addEventListener('click',fecharEdicaoContrato);
recEl('contratoEdicaoModal').addEventListener('cancel',e=>{if(contratoSalvando)e.preventDefault()});
recEl('contratoEdicaoForm').addEventListener('submit',async e=>{
 e.preventDefault();if(contratoSalvando||!contratoEmEdicao)return;
 const d={numero:recEl('contratoEdicaoNumero').value.trim(),tipo_pagamento:recEl('contratoEdicaoTipo').value,prazo_meses:Number(recEl('contratoEdicaoPrazo').value),inicio:recEl('contratoEdicaoInicio').value,primeiro_vencimento:recEl('contratoEdicaoVencimento').value,valor_parcela:Number(recEl('contratoEdicaoValor').value),contrato_esperado:contratoEmEdicao};
 const passo={avista:0,mensal:1,trimestral:3,semestral:6,anual:12}[d.tipo_pagamento],n=passo?Math.ceil(d.prazo_meses/passo):1;
 if(!confirm(`Salvar as informações do contrato?\nCronograma: ${n} pagamento(s) de referência. Valor das parcelas em aberto: ${moeda(d.valor_parcela)}.\nAs parcelas em aberto serão ajustadas se houver mudança nas condições. Parcelas fora do novo prazo serão excluídas; parcelas adicionais serão criadas. Recebimentos já registrados serão preservados.`))return;
 const botao=e.target.querySelector('[type="submit"]');contratoSalvando=true;botao.disabled=true;recEl('contratoEdicaoErro').textContent='';
 try{const r=await api('/api/receitas/arcm/contratos/'+contratoEmEdicao.id,{method:'PUT',body:JSON.stringify(d)});recEl('contratoEdicaoModal').close();recEl('recModal').close();await recCarregar('arcm');msg(`Contrato atualizado. ${r.atualizadas} parcela(s) ajustada(s), ${r.criadas} criada(s) e ${r.removidas} removida(s).`)}catch(e){recEl('contratoEdicaoErro').textContent=e.message}finally{contratoSalvando=false;botao.disabled=false}
});
