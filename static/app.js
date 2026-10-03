const moeda=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dataBR=d=>d?new Date(d+'T12:00:00').toLocaleDateString('pt-BR'):'-';
let clientes=[];
let paginaClientes=1,paginaOrgaos=1;
const LINHAS_TABELA=5;
let pagamentos=[];
let charts={};

function statusClass(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_')}
function msg(texto,tipo='ok'){const el=document.getElementById('mensagem');el.textContent=texto;el.className='mensagem '+tipo;setTimeout(()=>el.className='mensagem',3500)}
async function api(url,op={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...op});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.erro||'Erro no servidor');return d}
function mesLabel(ym){if(!ym)return '';const [a,m]=ym.split('-').map(Number);return new Intl.DateTimeFormat('pt-BR',{month:'short',year:'2-digit'}).format(new Date(a,m-1,1)).replace('.','')}
function destroyChart(nome){if(charts[nome]){charts[nome].destroy();delete charts[nome]}}
function chartBase(){return {responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{usePointStyle:true,boxWidth:8,font:{size:12}}},tooltip:{callbacks:{label:c=>`${c.dataset.label||c.label}: ${moeda(c.raw)}`}}}}}

function escaparFinanceiro(valor){
  return String(valor ?? '').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function preencherClientes(){
  const select=document.getElementById('pagCliente');
  if(!select)return;
  const selecionado=select.value;
  select.innerHTML='<option value="">Selecione...</option>'+clientes.map(c=>`<option value="${c.id}">${escaparFinanceiro(c.nome)}</option>`).join('');
  select.value=clientes.some(c=>String(c.id)===selecionado)?selecionado:'';
  renderFinanceiroCliente();
}
function renderFinanceiroCliente(){
  const id=Number(document.getElementById('pagCliente')?.value||0);
  const cliente=clientes.find(c=>Number(c.id)===id);
  const valores={finDivida:moeda(cliente?.divida),finPago:moeda(cliente?.total_pago),finDesconto:'Descontos: '+moeda(cliente?.total_desconto),finSaldo:moeda(cliente?.saldo),finPrevisao:cliente?dataBR(cliente.previsao):'—'};
  Object.entries(valores).forEach(([campo,valor])=>{const el=document.getElementById(campo);if(el)el.textContent=valor});
  document.querySelectorAll('#pagamentoForm input, #pagamentoForm button').forEach(el=>el.disabled=!cliente);
  atualizarResumoPagamento();
  const body=document.getElementById('pagamentosBody');
  if(!body)return;
  if(!cliente){body.innerHTML='<tr><td colspan="5" class="empty">Selecione um cliente para consultar os pagamentos.</td></tr>';return}
  const historico=pagamentos.filter(p=>Number(p.cliente_id)===id).slice().sort((a,b)=>String(b.data).localeCompare(String(a.data))||Number(b.id)-Number(a.id));
  body.innerHTML=historico.length?historico.map(p=>`<tr><td>${dataBR(p.data)}</td><td>${moeda(p.valor)}</td><td>${moeda(p.desconto)}</td><td>${escaparFinanceiro(p.observacao||'-')}</td><td><button class="danger icon-btn" title="Excluir pagamento" aria-label="Excluir pagamento" onclick="excluirPagamento(${Number(p.id)})">🗑</button></td></tr>`).join(''):'<tr><td colspan="5" class="empty">Nenhum pagamento registrado para este cliente.</td></tr>';
}

async function carregarClientes(){paginaClientes=1;const q=document.getElementById('buscaCliente').value.trim();clientes=await api('/api/clientes'+(q?'?q='+encodeURIComponent(q):''));renderClientes();preencherClientes()}
async function carregarPagamentos(){pagamentos=await api('/api/pagamentos');renderFinanceiroCliente()}

function graficoBarras(nome,id,labels,datasets,horizontal=false,empilhado=false){
  destroyChart(nome);
  const canvas=document.getElementById(id);
  let dados=document.getElementById(id+'Dados');
  if(!dados){dados=document.createElement('details');dados.id=id+'Dados';dados.className='chart-data';canvas.parentElement.insertAdjacentElement('afterend',dados)}
  dados.innerHTML='<summary>Ver valores</summary><div class="table-wrap"><table><thead><tr><th>Período / categoria</th>'+datasets.map(d=>`<th>${escaparFinanceiro(d.label)}</th>`).join('')+'</tr></thead><tbody>'+labels.map((l,i)=>`<tr><td>${escaparFinanceiro(l)}</td>${datasets.map(d=>`<td>${moeda(d.data[i])}</td>`).join('')}</tr>`).join('')+'</tbody></table></div>';
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label',labels.length?datasets.map(d=>d.label).join(', ')+'. Valores disponíveis abaixo.':'Sem dados no período.');
  if(typeof Chart!=='function')return;
  charts[nome]=new Chart(canvas,{type:'bar',data:{labels,datasets:datasets.map(d=>({...d,borderRadius:4,maxBarThickness:28}))},options:{...chartBase(),indexAxis:horizontal?'y':'x',animation:false,plugins:{...chartBase().plugins,legend:{display:datasets.length>1,position:'bottom',labels:{usePointStyle:true,font:{size:12}}}},scales:{x:{stacked:empilhado,beginAtZero:true,grid:{display:!horizontal?false:true},ticks:{maxRotation:0,font:{size:12},...(horizontal?{callback:v=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(v)}:{})}},y:{stacked:empilhado,beginAtZero:true,grid:{display:!horizontal},ticks:{font:{size:12},...(!horizontal?{callback:v=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(v)}:{})}}}}});
}
function renderGraficos(d){
  const o=d.orgaos||{};
  graficoBarras('carteira','chartCarteira',['Recebido','Falta receber','Descontos'],[{label:'Valor (R$)',data:[d.total_recebido,d.saldo_devedor,d.total_desconto||0],backgroundColor:['#177f58','#d9682d','#89939e']}],true);
  graficoBarras('recebimentos','chartRecebimentos',d.recebimentos_mensais.map(x=>mesLabel(x.mes)),[{label:'Recebido (R$)',data:d.recebimentos_mensais.map(x=>x.valor),backgroundColor:'#177f58'}]);
  graficoBarras('previsao','chartPrevisao',d.previsao_mensal.map(x=>mesLabel(x.mes)),[{label:'Previsão (R$)',data:d.previsao_mensal.map(x=>x.valor),backgroundColor:'#466886'}]);
  graficoBarras('orgaosStatus','chartOrgaosStatus',['Pago','Em aberto','Descontos'],[{label:'Valor (R$)',data:[o.total_pago||0,o.total_nao_pago||0,o.total_desconto||0],backgroundColor:['#177f58','#d9682d','#89939e']}],true);
  graficoBarras('orgaosAno','chartOrgaosAno',(o.por_ano||[]).map(x=>x.ano),[{label:'Pago',data:(o.por_ano||[]).map(x=>x.pago),backgroundColor:'#177f58'},{label:'Em aberto',data:(o.por_ano||[]).map(x=>x.nao_pago),backgroundColor:'#d9682d'},{label:'Descontos',data:(o.por_ano||[]).map(x=>x.desconto||0),backgroundColor:'#89939e'}],false,true);
  graficoBarras('orgaosTop','chartOrgaosTop',(o.top_devedores||[]).map(x=>x.nome),[{label:'Em aberto (R$)',data:(o.top_devedores||[]).map(x=>x.valor),backgroundColor:'#d9682d'}],true);
}

function botaoExcluirAviso(a){
  return `<button type="button" class="danger aviso-excluir" data-aviso="${escaparFinanceiro(a.aviso_chave)}" title="Excluir notificação" aria-label="Excluir notificação">🗑</button>`;
}
async function excluirNotificacao(chave){
  if(!confirm('Excluir esta notificação dos seus avisos? O cadastro e os valores serão mantidos.'))return;
  try{
    await api('/api/avisos/excluir',{method:'POST',body:JSON.stringify({chave})});
    await carregarDashboard();
    msg('Notificação excluída.');
  }catch(e){msg(e.message,'erro')}
}

function renderAvisosDashboard(d){
  const badge=document.getElementById('alertBadge');
  const panel=document.getElementById('alertPanelBody');
  const banner=document.getElementById('dueTodayBanner');
  const title=document.getElementById('dueTodayTitle');
  const text=document.getElementById('dueTodayText');

  const hoje=d.vencem_hoje||[];
  const atrasados=d.atrasados||[];
  const clientes60=d.clientes_60_dias||[];
  const orgaos60=d.orgaos_60_dias||[];
  const total=(d.total_alertas||0);

  if(badge){
    badge.textContent=total;
    badge.classList.toggle('hidden',total===0);
  }

  if(banner){
    if(hoje.length>0 || clientes60.length>0 || orgaos60.length>0){
      banner.classList.remove('hidden');
      if(clientes60.length>0 || orgaos60.length>0){
        title.textContent='Há débitos com 60 dias ou mais de atraso';
        const partes=[];
        if(clientes60.length)partes.push(`${clientes60.length} cliente${clientes60.length>1?'s':''}`);
        if(orgaos60.length)partes.push(`${orgaos60.length} débito${orgaos60.length>1?'s':''} de órgão público`);
        if(hoje.length)partes.push(`${hoje.length} vencimento${hoje.length>1?'s':''} previsto${hoje.length>1?'s':''} para hoje`);
        text.textContent=partes.join(' · ');
      }else{
        title.textContent='Há pagamentos previstos para hoje';
        text.textContent=`${hoje.length} cliente${hoje.length>1?'s':''} com vencimento hoje.`;
      }
    }else{
      banner.classList.add('hidden');
    }
  }

  if(!panel)return;
  let html='';
  const aniversarios=d.aniversarios_amanha||[];
  if(aniversarios.length){
    html+='<div class="alert-section-title">Aniversários de funcionários — amanhã</div>';
    html+=aniversarios.map(a=>`<div class="alert-item today">${botaoExcluirAviso(a)}<strong>${escaparFinanceiro(a.nome)}</strong><span>Aniversário amanhã: ${dataBR(a.data_aniversario)}</span><span>Completa ${Number(a.idade)} anos.</span></div>`).join('');
  }

  if(clientes60.length){
    html+=`<div class="alert-section-title critical-title">Clientes — 60 dias ou mais</div>`;
    html+=clientes60.map(a=>`<div class="alert-item critical">${botaoExcluirAviso(a)}
      <strong>${a.nome}</strong>
      <span>Vencimento: ${dataBR(a.previsao)} · ${a.dias_atraso} dias de atraso</span>
      <span class="alert-value">Saldo: ${moeda(a.saldo)}</span>
    </div>`).join('');
  }

  if(orgaos60.length){
    html+=`<div class="alert-section-title critical-title">Órgãos públicos — 60 dias ou mais</div>`;
    html+=orgaos60.map(a=>`<div class="alert-item critical public">${botaoExcluirAviso(a)}
      <strong>${a.nome_orgao}</strong>
      <span>Data: ${dataBR(a.data_debito)} · ${a.dias_atraso} dias de atraso</span>
      <span>NF: ${a.numero_nota_fiscal||'-'}${a.numero_ordem?` · Ordem: ${a.numero_ordem}`:''}</span>
      <span class="alert-value">Débito: ${moeda(a.valor_debito)}</span>
    </div>`).join('');
  }

  if(hoje.length){
    html+=`<div class="alert-section-title">Vencem hoje</div>`;
    html+=hoje.map(a=>`<div class="alert-item today">${botaoExcluirAviso(a)}
      <strong>${a.nome}</strong>
      <span>Previsão: ${dataBR(a.previsao)}</span>
      <span class="alert-value">Saldo: ${moeda(a.saldo)}</span>
    </div>`).join('');
  }

  if(atrasados.length){
    html+=`<div class="alert-section-title">Clientes atrasados até 59 dias</div>`;
    html+=atrasados.map(a=>`<div class="alert-item overdue">${botaoExcluirAviso(a)}
      <strong>${a.nome}</strong>
      <span>Vencimento: ${dataBR(a.previsao)} · ${a.dias_atraso} dias de atraso</span>
      <span class="alert-value">Saldo: ${moeda(a.saldo)}</span>
    </div>`).join('');
  }

  panel.innerHTML=html||'<div class="empty">Nenhum aviso pendente.</div>';
  panel.querySelectorAll('[data-aviso]').forEach(btn=>btn.addEventListener('click',()=>excluirNotificacao(btn.dataset.aviso))); 
}

async function carregarDashboard(){
  const d=await api('/api/dashboard');
  renderAvisosDashboard(d);
  document.getElementById('kpiReceber').textContent=moeda(d.total_receber);
  document.getElementById('kpiRecebido').textContent=moeda(d.total_recebido);
  document.getElementById('kpiSaldo').textContent=moeda(d.saldo_devedor);
  document.getElementById('kpiAtraso').textContent=d.clientes_atraso;
  document.getElementById('kpiAtrasadoValor').textContent=moeda(d.valor_atrasado)+' em atraso';
  const pct=d.total_receber>0?(d.total_recebido/d.total_receber)*100:0;
  document.getElementById('kpiPercentual').textContent=pct.toLocaleString('pt-BR',{maximumFractionDigits:1})+'% da carteira';
  document.getElementById('kpiPrevisto').textContent=moeda(d.total_previsto_futuro);
  document.getElementById('statusResumo').innerHTML=Object.entries(d.status).map(([k,v])=>`<div class="status-row"><span>${k}</span><strong>${v}</strong></div>`).join('');
  document.getElementById('dashClientes').innerHTML=d.proximos.length?d.proximos.map(c=>`<tr><td>${c.nome}</td><td>${dataBR(c.previsao)}</td><td>${moeda(c.saldo)}</td><td><span class="badge ${statusClass(c.status)}">${c.status}</span></td></tr>`).join(''):'<tr><td colspan="4" class="empty">Nenhum cliente cadastrado.</td></tr>';
  const aviso=document.getElementById('previsaoAviso');
  if(d.valor_atrasado>0){aviso.textContent=`Além da previsão futura, existem ${moeda(d.valor_atrasado)} em saldos vencidos.`;aviso.classList.remove('hidden')}else{aviso.classList.add('hidden')}

  const o=d.orgaos||{};
  document.getElementById('orgDashTotal').textContent=moeda(o.total||0);
  document.getElementById('orgDashPago').textContent=moeda(o.total_pago||0);
  document.getElementById('orgDashAberto').textContent=moeda(o.total_nao_pago||0);
  document.getElementById('orgDashQtd').textContent=o.quantidade||0;
  document.getElementById('orgDashPagoQtd').textContent=`${o.quantidade_pago||0} registros pagos · Descontos: ${moeda(o.total_desconto)}`;
  document.getElementById('orgDashAbertoQtd').textContent=`${o.quantidade_nao_pago||0} registros em aberto`;
  renderGraficos(d);
  await carregarDespesasDashboard();
}

function documentoFormatado(v){
  const d=String(v||'').replace(/\D/g,'');
  if(d.length===11)return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');
  if(d.length===14)return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5');
  return v||'-';
}
function localCliente(c){return [c.cidade,c.uf].filter(Boolean).join('/')||'-'}

function renderClientes(){
  const body=document.getElementById('clientesBody');
  paginaClientes=Math.min(paginaClientes,Math.max(1,Math.ceil(clientes.length/LINHAS_TABELA)));
  renderPaginacaoTabela('clientes',paginaClientes,clientes.length,mudarPaginaClientes);
  body.innerHTML=clientes.length?clientes.slice((paginaClientes-1)*LINHAS_TABELA,paginaClientes*LINHAS_TABELA).map(c=>`<tr>
    <td><strong>${c.nome}</strong><div class="table-sub">${c.tipo_pessoa==='PJ'?'Pessoa Jurídica':'Pessoa Física'}</div></td>
    <td>${c.whatsapp||c.telefone||'-'}</td>
    <td>${moeda(c.divida)}</td>
    <td>${dataBR(c.previsao)}</td>
    <td>${moeda(c.saldo)}</td>
    <td><span class="badge ${statusClass(c.status)}">${c.status}</span></td>
    <td>
      <div class="acoes icon-actions">
        <button class="view icon-btn" title="Ver ficha do cliente" aria-label="Ver ficha do cliente" onclick="mostrarCliente(${c.id})">👁</button>
        <button class="edit icon-btn" title="Editar cliente" aria-label="Editar cliente" onclick="editarCliente(${c.id})">✎</button>
        <button class="danger icon-btn" title="Excluir cliente" aria-label="Excluir cliente" onclick="excluirCliente(${c.id})">🗑</button>
      </div>
    </td>
  </tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhum cliente cadastrado.</td></tr>';
}
function abrirFinanceiroCliente(id){
  const sel=document.getElementById('pagCliente');if(!sel)return;
  sel.value=String(id);renderFinanceiroCliente();
  document.getElementById('clienteFinanceiro')?.scrollIntoView({behavior:'smooth',block:'start'});
}
async function atualizarTudo(){await Promise.all([carregarClientes(),carregarPagamentos(),carregarDashboard()])}

function campo(id){return document.getElementById(id)?.value?.trim()||''}
function payloadCliente(){return {
  nome:campo('nomeCliente'),tipo_pessoa:campo('tipoPessoa')||'PF',cpf_cnpj:campo('cpfCnpj'),rg_ie:campo('rgIe'),
  data_nascimento:campo('dataNascimento')||null,telefone:campo('telefoneCliente'),whatsapp:campo('whatsappCliente'),email:campo('emailCliente'),
  cep:campo('cepCliente'),logradouro:campo('logradouroCliente'),numero:campo('numeroCliente'),complemento:campo('complementoCliente'),
  bairro:campo('bairroCliente'),cidade:campo('cidadeCliente'),uf:campo('ufCliente').toUpperCase(),observacoes:campo('observacoesCliente'),
  divida:Number(document.getElementById('valorDivida').value||0),previsao:campo('previsaoPagamento')||null
}}
document.getElementById('clienteForm').addEventListener('submit',async e=>{e.preventDefault();const id=document.getElementById('clienteId').value;try{await api(id?'/api/clientes/'+id:'/api/clientes',{method:id?'PUT':'POST',body:JSON.stringify(payloadCliente())});msg(id?'Cliente atualizado.':'Cliente cadastrado.');limparEdicao();await atualizarTudo()}catch(err){msg(err.message,'erro')}})
function abrirCadastroCliente(){
  limparFormularioCliente(false);
  const card=document.getElementById('clienteCadastroCard');
  card?.classList.remove('hidden');
  document.getElementById('tituloCliente').textContent='Cadastrar cliente';
  document.getElementById('cancelarEdicao').textContent='Fechar ficha';
  document.getElementById('cancelarEdicao').classList.remove('hidden');
  card?.scrollIntoView({behavior:'smooth',block:'start'});
}
function editarCliente(id){
  const c=clientes.find(x=>x.id===id);if(!c)return;
  const card=document.getElementById('clienteCadastroCard');
  card?.classList.remove('hidden');
  const vals={clienteId:c.id,nomeCliente:c.nome,tipoPessoa:c.tipo_pessoa||'PF',cpfCnpj:documentoFormatado(c.cpf_cnpj)==='-'?'':documentoFormatado(c.cpf_cnpj),rgIe:c.rg_ie||'',dataNascimento:c.data_nascimento||'',telefoneCliente:c.telefone||'',whatsappCliente:c.whatsapp||'',emailCliente:c.email||'',cepCliente:c.cep||'',logradouroCliente:c.logradouro||'',numeroCliente:c.numero||'',complementoCliente:c.complemento||'',bairroCliente:c.bairro||'',cidadeCliente:c.cidade||'',ufCliente:c.uf||'',observacoesCliente:c.observacoes||'',valorDivida:c.divida,previsaoPagamento:c.previsao||''};
  Object.entries(vals).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.value=v});
  document.getElementById('tituloCliente').textContent='Editar cliente';
  document.getElementById('cancelarEdicao').textContent='Cancelar edição';
  document.getElementById('cancelarEdicao').classList.remove('hidden');
  card?.scrollIntoView({behavior:'smooth',block:'start'});
}
function limparFormularioCliente(fechar=true){
  document.getElementById('clienteForm').reset();
  document.getElementById('clienteId').value='';
  document.getElementById('tipoPessoa').value='PF';
  document.getElementById('tituloCliente').textContent='Cadastrar cliente';
  document.getElementById('cancelarEdicao').textContent='Fechar ficha';
  if(fechar) document.getElementById('clienteCadastroCard')?.classList.add('hidden');
}
function limparEdicao(){limparFormularioCliente(true)}
document.getElementById('novoClienteBtn')?.addEventListener('click',abrirCadastroCliente);
document.getElementById('cancelarEdicao').onclick=limparEdicao;
async function excluirCliente(id){if(!confirm('Excluir este cliente e todos os pagamentos vinculados?'))return;try{await api('/api/clientes/'+id,{method:'DELETE'});msg('Cliente excluído.');await atualizarTudo()}catch(err){msg(err.message,'erro')}}

function detalheLinha(rotulo,valor){return `<div class="detail-item"><span>${rotulo}</span><strong>${valor||'-'}</strong></div>`}
function mostrarCliente(id){const c=clientes.find(x=>x.id===id);if(!c)return;document.getElementById('clienteModalNome').textContent=c.nome;const endereco=[c.logradouro,c.numero,c.complemento,c.bairro,c.cidade,c.uf,c.cep].filter(Boolean).join(', ');document.getElementById('clienteModalBody').innerHTML=`
  <div class="detail-section"><h4>Identificação</h4><div class="detail-grid">${detalheLinha('Tipo',c.tipo_pessoa==='PJ'?'Pessoa Jurídica':'Pessoa Física')}${detalheLinha('CPF/CNPJ',documentoFormatado(c.cpf_cnpj))}${detalheLinha('RG/IE',c.rg_ie)}${detalheLinha('Nascimento/Fundação',dataBR(c.data_nascimento))}</div></div>
  <div class="detail-section"><h4>Contato</h4><div class="detail-grid">${detalheLinha('Telefone',c.telefone)}${detalheLinha('WhatsApp',c.whatsapp)}${detalheLinha('E-mail',c.email)}</div></div>
  <div class="detail-section"><h4>Endereço</h4><div class="detail-grid">${detalheLinha('Endereço completo',endereco)}</div></div>
  <div class="detail-section"><h4>Financeiro</h4><div class="detail-grid">${detalheLinha('Dívida inicial',moeda(c.divida))}${detalheLinha('Total pago',moeda(c.total_pago))}${detalheLinha('Descontos',moeda(c.total_desconto))}${detalheLinha('Saldo',moeda(c.saldo))}${detalheLinha('Previsão',dataBR(c.previsao))}${detalheLinha('Último pagamento',dataBR(c.ultimo_pagamento))}${detalheLinha('Status',c.status)}</div></div>
  ${c.observacoes?`<div class="detail-section"><h4>Observações</h4><p class="detail-notes">${c.observacoes}</p></div>`:''}`;document.getElementById('clienteModal').classList.remove('hidden');document.getElementById('clienteModalOverlay').classList.remove('hidden')}
function fecharClienteModal(){document.getElementById('clienteModal').classList.add('hidden');document.getElementById('clienteModalOverlay').classList.add('hidden')}
document.getElementById('fecharClienteModal')?.addEventListener('click',fecharClienteModal);document.getElementById('clienteModalOverlay')?.addEventListener('click',fecharClienteModal);
function mascaraDocumento(e){let v=e.target.value.replace(/\D/g,'').slice(0,14);if(v.length<=11){v=v.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2')}else{v=v.replace(/^(\d{2})(\d)/,'$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/,'$1.$2.$3').replace(/\.(\d{3})(\d)/,'.$1/$2').replace(/(\d{4})(\d)/,'$1-$2')}e.target.value=v}
function mascaraCep(e){let v=e.target.value.replace(/\D/g,'').slice(0,8);if(v.length>5)v=v.slice(0,5)+'-'+v.slice(5);e.target.value=v}
document.getElementById('cpfCnpj')?.addEventListener('input',mascaraDocumento);document.getElementById('cepCliente')?.addEventListener('input',mascaraCep);document.getElementById('ufCliente')?.addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,2));

document.getElementById('pagamentoForm').addEventListener('submit',async e=>{e.preventDefault();const clienteId=Number(document.getElementById('pagCliente').value||0);if(!clienteId){msg('Selecione um cliente antes de registrar o pagamento.','erro');return}try{await api('/api/pagamentos',{method:'POST',body:JSON.stringify({cliente_id:clienteId,data:document.getElementById('pagData').value,valor:Number(document.getElementById('pagValor').value),desconto:Number(document.getElementById('pagDesconto').value||0),observacao:document.getElementById('pagObs').value.trim()})});msg('Pagamento registrado.');document.getElementById('pagValor').value='';document.getElementById('pagDesconto').value='0';document.getElementById('pagObs').value='';if(document.getElementById('pagData'))document.getElementById('pagData').valueAsDate=new Date();await atualizarTudo();document.getElementById('pagCliente').value=String(clienteId);renderFinanceiroCliente()}catch(err){msg(err.message,'erro')}})
async function excluirPagamento(id){if(!confirm('Excluir este pagamento e estornar também o desconto vinculado?'))return;const clienteId=document.getElementById('pagCliente')?.value||'';try{await api('/api/pagamentos/'+id,{method:'DELETE'});msg('Pagamento excluído.');await atualizarTudo();if(clienteId){document.getElementById('pagCliente').value=clienteId;renderFinanceiroCliente()}}catch(err){msg(err.message,'erro')}}
document.getElementById('pagCliente')?.addEventListener('change',renderFinanceiroCliente);

document.getElementById('buscaCliente').addEventListener('input',()=>{clearTimeout(window._b);window._b=setTimeout(carregarClientes,250)})

// Atalhos internos do dashboard
document.querySelectorAll('[data-go-tab]').forEach(btn=>btn.addEventListener('click',()=>{
  const target=btn.dataset.goTab;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===target));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.id===target));
  if(target==='orgaos' && typeof carregarOrgaosPublicos==='function') carregarOrgaosPublicos();
  window.scrollTo({top:0,behavior:'smooth'});
}));
document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');document.getElementById(btn.dataset.tab).classList.add('active');if(btn.dataset.tab==='dashboard')setTimeout(()=>Object.values(charts).forEach(c=>c.resize()),80)}))
document.getElementById('pagData').valueAsDate=new Date();
atualizarTudo().catch(err=>msg(err.message,'erro'));


// Interface administrativa moderna
const hojeFormatado=new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long'}).format(new Date());
const dataHoje=document.getElementById('dataHoje');if(dataHoje)dataHoje.textContent=hojeFormatado.charAt(0).toUpperCase()+hojeFormatado.slice(1);
const sidebar=document.getElementById('sidebar');
const menuToggle=document.getElementById('menuToggle');
if(menuToggle)menuToggle.addEventListener('click',()=>sidebar.classList.toggle('open'));
document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>{if(window.innerWidth<=820)sidebar.classList.remove('open')}));
function abrirAvisos(){document.getElementById('alertPanel').classList.add('open');document.getElementById('alertOverlay').classList.remove('hidden')}
function fecharAvisos(){document.getElementById('alertPanel').classList.remove('open');document.getElementById('alertOverlay').classList.add('hidden')}
document.getElementById('alertButton')?.addEventListener('click',abrirAvisos);
document.getElementById('openDueAlerts')?.addEventListener('click',abrirAvisos);
document.getElementById('closeAlerts')?.addEventListener('click',fecharAvisos);
document.getElementById('alertOverlay')?.addEventListener('click',fecharAvisos);

// Gestão de usuários (somente administrador)
let usuarios=[];
async function carregarUsuarios(){
  if(!window.IS_ADMIN) return;
  usuarios=await api('/api/usuarios');
  const body=document.getElementById('usuariosBody');
  if(!body) return;
  body.innerHTML=usuarios.length?usuarios.map(u=>`<tr>
    <td>${u.nome}</td><td>${u.username}</td>
    <td><span class="role-badge ${u.role==='admin'?'role-admin':'role-user'}">${u.role==='admin'?'Administrador':'Usuário'}</span></td>
    <td><span class="badge ${u.ativo?'QUITADO':'SEM_PREVISAO'}">${u.ativo?'ATIVO':'INATIVO'}</span></td>
    <td>${u.criado_em?new Date(u.criado_em).toLocaleDateString('pt-BR'):'-'}</td>
    <td><div class="acoes"><button class="edit" onclick="editarUsuario(${u.id})">Editar</button><button class="danger" onclick="excluirUsuario(${u.id})">Excluir</button></div></td>
  </tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum usuário cadastrado.</td></tr>';
}
function limparUsuario(){
  const f=document.getElementById('usuarioForm');if(!f)return;f.reset();
  document.getElementById('usuarioId').value='';document.getElementById('usuarioAtivo').checked=true;
  document.getElementById('usuarioLogin').disabled=false;document.getElementById('usuarioSenha').required=true;
  document.getElementById('tituloUsuario').textContent='Criar novo usuário';document.getElementById('cancelarUsuario').classList.add('hidden');
}
function editarUsuario(id){
  const u=usuarios.find(x=>x.id===id);if(!u)return;
  document.getElementById('usuarioId').value=u.id;document.getElementById('usuarioNome').value=u.nome;
  document.getElementById('usuarioLogin').value=u.username;document.getElementById('usuarioLogin').disabled=true;
  document.getElementById('usuarioSenha').value='';document.getElementById('usuarioSenha').required=false;
  document.getElementById('usuarioSenha').placeholder='Deixe em branco para manter a senha';
  document.getElementById('usuarioRole').value=u.role;document.getElementById('usuarioAtivo').checked=u.ativo;
  document.getElementById('tituloUsuario').textContent='Editar usuário';document.getElementById('cancelarUsuario').classList.remove('hidden');
}
async function excluirUsuario(id){
  if(!confirm('Excluir este usuário do sistema?'))return;
  try{await api('/api/usuarios/'+id,{method:'DELETE'});msg('Usuário excluído.');await carregarUsuarios()}catch(err){msg(err.message,'erro')}
}
if(window.IS_ADMIN){
  const uf=document.getElementById('usuarioForm');
  if(uf){
    document.getElementById('usuarioSenha').required=true;
    uf.addEventListener('submit',async e=>{e.preventDefault();const id=document.getElementById('usuarioId').value;
      const payload={nome:document.getElementById('usuarioNome').value.trim(),username:document.getElementById('usuarioLogin').value.trim(),senha:document.getElementById('usuarioSenha').value,role:document.getElementById('usuarioRole').value,ativo:document.getElementById('usuarioAtivo').checked};
      try{await api(id?'/api/usuarios/'+id:'/api/usuarios',{method:id?'PUT':'POST',body:JSON.stringify(payload)});msg(id?'Usuário atualizado.':'Usuário criado.');limparUsuario();await carregarUsuarios()}catch(err){msg(err.message,'erro')}
    });
    document.getElementById('cancelarUsuario').onclick=limparUsuario;
    carregarUsuarios().catch(err=>msg(err.message,'erro'));
  }
}

// Controle de débitos de órgãos públicos
let orgaosPublicos=[];
let orgSelecionados=new Set(),orgConsulta=0,orgRecebendo=false;
async function carregarOrgaosPublicos(){
  const consulta=++orgConsulta;paginaOrgaos=1;
  orgSelecionados.clear();orgaosPublicos=[];renderOrgaosPublicos();
  document.getElementById('orgLoteDesconto').value='0';
  const params=new URLSearchParams();
  const q=document.getElementById('buscaOrgao')?.value.trim();
  const ano=document.getElementById('filtroAnoOrgao')?.value.trim();
  const status=document.getElementById('filtroStatusOrgao')?.value;
  const orgao=document.getElementById('filtroDevedorOrgao').value;
  if(orgao)params.set('orgao',orgao);
  if(q)params.set('q',q);if(ano)params.set('ano',ano);if(status)params.set('status',status);
  const d=await api('/api/orgaos-publicos'+(params.toString()?'?'+params.toString():''));
  if(consulta!==orgConsulta)return;
  const filtro=document.getElementById('filtroDevedorOrgao');
  filtro.innerHTML='<option value="">Todos os órgãos devedores</option>'+(d.orgaos_devedores||[]).map(nome=>`<option value="${escaparFinanceiro(nome)}">${escaparFinanceiro(nome)}</option>`).join('');
  filtro.value=orgao;
  orgaosPublicos=d.registros||[];
  const r=d.resumo||{};
  if(document.getElementById('govQtd')) document.getElementById('govQtd').textContent=r.quantidade||0;
  if(document.getElementById('govTotal')) document.getElementById('govTotal').textContent=moeda(r.total||0);
  document.getElementById('govDesconto').textContent='Descontos: '+moeda(r.total_desconto);
  if(document.getElementById('govPago')) document.getElementById('govPago').textContent=moeda(r.total_pago||0);
  if(document.getElementById('govNaoPago')) document.getElementById('govNaoPago').textContent=moeda(r.total_nao_pago||0);
  renderOrgaosPublicos();
}
function renderOrgaosPublicos(){
  const body=document.getElementById('orgaosBody');if(!body)return;
  paginaOrgaos=Math.min(paginaOrgaos,Math.max(1,Math.ceil(orgaosPublicos.length/LINHAS_TABELA)));
  renderPaginacaoTabela('orgaos',paginaOrgaos,orgaosPublicos.length,mudarPaginaOrgaos);
  body.innerHTML=orgaosPublicos.length?orgaosPublicos.slice((paginaOrgaos-1)*LINHAS_TABELA,paginaOrgaos*LINHAS_TABELA).map(r=>`<tr>
    <td><input type="checkbox" class="org-selecao" data-id="${r.id}" ${r.pago||orgRecebendo?'disabled':''} ${orgSelecionados.has(r.id)?'checked':''} aria-label="Selecionar débito ${r.id}"></td>
    <td><strong>${r.nome_orgao}</strong></td><td>${r.tipo_orgao}</td><td>${String(r.dia).padStart(2,'0')}/${String(r.mes).padStart(2,'0')}/${r.ano}</td>
    <td>${moeda(r.valor_debito)}${r.pago?`<small class="desconto-detalhe">Desconto: ${moeda(r.desconto)}<br>Recebido: ${moeda(r.valor_recebido)}</small>`:''}</td>
    <td><label class="paid-check"><input type="checkbox" ${r.pago?'checked':''} onchange="definirPagoOrgao(${r.id}, this.checked)"><span>Pago</span></label></td>
    <td>${r.numero_nota_fiscal}</td><td>${r.numero_ordem||'-'}</td>
    <td><div class="acoes icon-actions"><button class="edit icon-btn" title="Editar débito" aria-label="Editar débito" onclick="editarOrgaoPublico(${r.id})">✎</button><button class="danger icon-btn" title="Excluir débito" aria-label="Excluir débito" onclick="excluirOrgaoPublico(${r.id})">🗑</button></div></td>
  </tr>`).join(''):'<tr><td colspan="9" class="empty">Nenhum débito de órgão público cadastrado.</td></tr>';
  body.querySelectorAll('.org-selecao').forEach(el=>el.addEventListener('change',()=>{
    const id=Number(el.dataset.id);if(el.checked)orgSelecionados.add(id);else orgSelecionados.delete(id);atualizarSelecaoOrgaos();
  }));
  atualizarSelecaoOrgaos();
}
function limparOrgaoPublico(){
  const f=document.getElementById('orgaoForm');if(!f)return;f.reset();document.getElementById('orgaoId').value='';document.getElementById('orgaoPago').checked=false;atualizarDescontoOrgao();document.getElementById('tituloOrgao').textContent='Cadastrar débito de órgão público';document.getElementById('cancelarOrgao').classList.add('hidden');document.getElementById('orgaoCadastroCard').open=false;
}
function editarOrgaoPublico(id){
  const r=orgaosPublicos.find(x=>x.id===id);if(!r)return;
  document.getElementById('orgaoId').value=r.id;document.getElementById('orgaoNome').value=r.nome_orgao;document.getElementById('orgaoTipo').value=r.tipo_orgao;document.getElementById('orgaoData').value=r.data_debito;document.getElementById('orgaoValor').value=r.valor_debito;document.getElementById('orgaoNota').value=r.numero_nota_fiscal;document.getElementById('orgaoOrdem').value=r.numero_ordem||'';document.getElementById('orgaoPago').checked=!!r.pago;document.getElementById('orgaoDesconto').value=r.desconto||0;atualizarDescontoOrgao();document.getElementById('tituloOrgao').textContent='Editar débito de órgão público';document.getElementById('cancelarOrgao').classList.remove('hidden');document.getElementById('orgaoCadastroCard').open=true;document.getElementById('orgaoCadastroCard').scrollIntoView({behavior:'smooth',block:'start'});
}
async function definirPagoOrgao(id, pago){
  let desconto=0;
  if(pago){
    const r=orgaosPublicos.find(x=>x.id===id);
    const entrada=prompt(`Desconto em reais sobre ${moeda(r?.valor_debito)} (0 para nenhum):`,'0');
    if(entrada===null){renderOrgaosPublicos();return}
    const texto=entrada.trim();
    if(!/^\d+(?:[.,]\d{1,2})?$/.test(texto)){msg('Informe um desconto válido em reais.','erro');renderOrgaosPublicos();return}
    desconto=Number(texto.replace(',','.'));
    if(desconto>Number(r.valor_debito)){msg('O desconto não pode superar o débito.','erro');renderOrgaosPublicos();return}
    if(!confirm(`Confirmar recebimento de ${moeda(Number(r.valor_debito)-desconto)}, com desconto de ${moeda(desconto)}?`)){renderOrgaosPublicos();return}
  }else if(!confirm('Reabrir o débito? O desconto será removido e o valor original voltará a ficar em aberto.')){renderOrgaosPublicos();return}
  try{
    await api('/api/orgaos-publicos/'+id+'/status',{method:'PATCH',body:JSON.stringify({pago,desconto})});
    msg(pago?'Débito marcado como pago.':'Débito voltou para em aberto.');
    await Promise.all([carregarOrgaosPublicos(),carregarDashboard()]);
  }catch(err){
    msg(err.message,'erro');
    await carregarOrgaosPublicos();
  }
}

async function excluirOrgaoPublico(id){
  if(!confirm('Excluir este débito de órgão público?'))return;
  try{await api('/api/orgaos-publicos/'+id,{method:'DELETE'});msg('Débito excluído.');await carregarOrgaosPublicos()}catch(err){msg(err.message,'erro')}
}
const orgaoForm=document.getElementById('orgaoForm');
if(orgaoForm){
  orgaoForm.addEventListener('submit',async e=>{e.preventDefault();const id=document.getElementById('orgaoId').value;const payload={nome_orgao:document.getElementById('orgaoNome').value.trim(),tipo_orgao:document.getElementById('orgaoTipo').value,data_debito:document.getElementById('orgaoData').value,valor_debito:Number(document.getElementById('orgaoValor').value),numero_nota_fiscal:document.getElementById('orgaoNota').value.trim(),numero_ordem:document.getElementById('orgaoOrdem').value.trim(),pago:document.getElementById('orgaoPago').checked,desconto:Number(document.getElementById('orgaoDesconto').value||0)};try{await api(id?'/api/orgaos-publicos/'+id:'/api/orgaos-publicos',{method:id?'PUT':'POST',body:JSON.stringify(payload)});msg(id?'Débito atualizado.':'Débito cadastrado.');limparOrgaoPublico();await Promise.all([carregarOrgaosPublicos(),carregarDashboard()])}catch(err){msg(err.message,'erro')}});
  document.getElementById('cancelarOrgao').addEventListener('click',limparOrgaoPublico);
  ['buscaOrgao','filtroAnoOrgao','filtroStatusOrgao','filtroDevedorOrgao'].forEach(id=>document.getElementById(id)?.addEventListener(id==='buscaOrgao'?'input':'change',()=>carregarOrgaosPublicos().catch(err=>msg(err.message,'erro'))));
  carregarOrgaosPublicos().catch(err=>msg(err.message,'erro'));
}

function atualizarResumoPagamento(){
  const cliente=clientes.find(c=>Number(c.id)===Number(document.getElementById('pagCliente').value));
  const recebido=Number(document.getElementById('pagValor').value||0),desconto=Number(document.getElementById('pagDesconto').value||0);
  const restante=Number(cliente?.saldo||0)-recebido-desconto;
  document.getElementById('pagResumo').textContent=!cliente?'Selecione um cliente.':restante<-.001?'O recebimento mais o desconto supera o saldo.':`Abatimento: ${moeda(recebido+desconto)} · Saldo após registro: ${moeda(Math.max(0,restante))}`;
}
['pagValor','pagDesconto'].forEach(id=>document.getElementById(id).addEventListener('input',atualizarResumoPagamento));
function atualizarDescontoOrgao(){
  const pago=document.getElementById('orgaoPago').checked,campo=document.getElementById('orgaoDesconto');
  campo.disabled=!pago;
  if(!pago)campo.value='0';
  const valor=Number(document.getElementById('orgaoValor').value||0),desconto=Number(campo.value||0);
  campo.max=String(valor);
  document.getElementById('orgaoRecebidoResumo').textContent=!pago?'Marque Pago para aplicar desconto.':desconto>valor?'O desconto supera o débito.':`Valor recebido: ${moeda(valor-desconto)}`;
}
document.getElementById('orgaoPago').addEventListener('change',atualizarDescontoOrgao);
['orgaoValor','orgaoDesconto'].forEach(id=>document.getElementById(id).addEventListener('input',atualizarDescontoOrgao));

function totalSelecaoOrgaos(){
  return orgaosPublicos.filter(r=>!r.pago&&orgSelecionados.has(r.id)).reduce((s,r)=>s+Math.round(Number(r.valor_debito)*100),0);
}
function atualizarSelecaoOrgaos(){
  const abertos=orgaosPublicos.filter(r=>!r.pago),n=abertos.filter(r=>orgSelecionados.has(r.id)).length,total=totalSelecaoOrgaos();
  const todos=document.getElementById('orgSelecionarTodos');
  todos.checked=n>0&&n===abertos.length;todos.indeterminate=n>0&&n<abertos.length;todos.disabled=!abertos.length||orgRecebendo;
  const campo=document.getElementById('orgLoteDesconto');campo.disabled=!n||orgRecebendo;campo.max=String(total/100);
  const desconto=Number(campo.value||0),valido=Number.isFinite(desconto)&&desconto>=0&&desconto<=total/100&&Math.abs(desconto*100-Math.round(desconto*100))<.00001;
  document.getElementById('orgSelecionadosResumo').textContent=n?`${n} débito(s) selecionado(s) · Total: ${moeda(total/100)}`:'Nenhum débito selecionado';
  document.getElementById('orgLoteLiquido').textContent=valido?moeda((total-Math.round(desconto*100))/100):'Desconto inválido';
  document.getElementById('orgLoteConfirmar').disabled=!n||!valido||orgRecebendo;
  document.getElementById('orgLimparSelecao').disabled=!n||orgRecebendo;
}
document.getElementById('orgSelecionarTodos').addEventListener('change',e=>{
  orgSelecionados=new Set(e.target.checked?orgaosPublicos.filter(r=>!r.pago).map(r=>r.id):[]);renderOrgaosPublicos();
});
document.getElementById('orgLimparSelecao').addEventListener('click',()=>{orgSelecionados.clear();document.getElementById('orgLoteDesconto').value='0';renderOrgaosPublicos()});
document.getElementById('orgLoteDesconto').addEventListener('input',atualizarSelecaoOrgaos);
document.getElementById('orgReceberLote').addEventListener('submit',async e=>{
  e.preventDefault();if(orgRecebendo)return;
  atualizarSelecaoOrgaos();if(document.getElementById('orgLoteConfirmar').disabled)return;
  const ids=orgaosPublicos.filter(r=>!r.pago&&orgSelecionados.has(r.id)).map(r=>r.id);
  const total=totalSelecaoOrgaos()/100,desconto=Number(document.getElementById('orgLoteDesconto').value||0);
  if(!confirm(`Receber ${ids.length} débito(s)?\nTotal: ${moeda(total)}\nDesconto: ${moeda(desconto)}\nValor recebido: ${moeda(total-desconto)}\nTodos os débitos selecionados serão marcados como pagos.`))return;
  orgRecebendo=true;renderOrgaosPublicos();
  try{
    const resultado=await api('/api/orgaos-publicos/receber-selecionados',{method:'POST',body:JSON.stringify({ids,desconto,total_esperado:total})});
    msg(`${resultado.quantidade} débito(s) pago(s). Recebido: ${moeda(resultado.valor_recebido)}.`);
    await Promise.all([carregarOrgaosPublicos(),carregarDashboard()]);
  }catch(err){msg(err.message,'erro')}
  finally{orgRecebendo=false;renderOrgaosPublicos()}
});

function renderPaginacaoTabela(prefixo,pagina,total,mudar){
  const paginas=Math.max(1,Math.ceil(total/LINHAS_TABELA));
  document.getElementById(prefixo+'PaginaResumo').textContent=total?`${(pagina-1)*LINHAS_TABELA+1}–${Math.min(pagina*LINHAS_TABELA,total)} de ${total} registros · Página ${pagina} de ${paginas}`:'Nenhum registro';
  const nav=document.getElementById(prefixo+'Paginas');
  const numeros=[...new Set([1,pagina-1,pagina,pagina+1,paginas])].filter(n=>n>=1&&n<=paginas).sort((a,b)=>a-b);
  let html=`<button type="button" class="secondary" data-pagina="${pagina-1}" ${pagina===1?'disabled':''}>Anterior</button>`;
  numeros.forEach((n,i)=>{if(i&&n-numeros[i-1]>1)html+='<span>…</span>';html+=`<button type="button" class="${n===pagina?'primary':'secondary'}" data-pagina="${n}" ${n===pagina?'aria-current="page"':''}>${n}</button>`});
  nav.innerHTML=html+`<button type="button" class="secondary" data-pagina="${pagina+1}" ${pagina===paginas?'disabled':''}>Próxima</button>`;
  nav.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>mudar(Number(b.dataset.pagina))));
}
function mudarPaginaClientes(n){if(!Number.isInteger(n)||n<1||n>Math.ceil(clientes.length/LINHAS_TABELA))return;paginaClientes=n;renderClientes()}
function mudarPaginaOrgaos(n){if(!Number.isInteger(n)||n<1||n>Math.ceil(orgaosPublicos.length/LINHAS_TABELA))return;paginaOrgaos=n;renderOrgaosPublicos()}
let consultaDespDashboard=0;
async function carregarDespesasDashboard(){
  const campo=document.getElementById('dashDespMes');
  if(!campo.value){const partes=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit'}).formatToParts(new Date());campo.value=partes.find(p=>p.type==='year').value+'-'+partes.find(p=>p.type==='month').value}
  const consulta=++consultaDespDashboard;
  document.getElementById('dashDespAviso').textContent='Carregando despesas…';
  try{
    const d=await api('/api/despesas?mes='+encodeURIComponent(campo.value));if(consulta!==consultaDespDashboard)return;
    const r=d.resumo||{};
    for(const [id,chave] of [['Total','total'],['Pago','pago'],['Aberto','aberto'],['Atrasado','atrasado']])document.getElementById('dashDesp'+id).textContent=moeda(r[chave]);
    document.getElementById('dashDespAviso').textContent=`${r.quantidade||0} despesa(s) no período de competência selecionado.`;
    const grupos=Object.entries(r.por_grupo||{});
    graficoBarras('despGrupos','chartDespGrupos',grupos.map(x=>x[0]),[{label:'Total',data:grupos.map(x=>x[1]),backgroundColor:'#466886'}],true);
    graficoBarras('despStatus','chartDespStatus',['Pago','Em aberto'],[{label:'Valor',data:[r.pago||0,r.aberto||0],backgroundColor:['#177f58','#d9682d']}],true);
    document.getElementById('dashDespGruposValores').innerHTML=grupos.map(([nome,valor])=>`<span>${escaparFinanceiro(nome)}: <strong>${moeda(valor)}</strong></span>`).join('');
    document.getElementById('dashDespStatusValores').textContent=`Pago: ${moeda(r.pago)} · Em aberto: ${moeda(r.aberto)}`;
  }catch(e){if(consulta!==consultaDespDashboard)return;for(const id of ['Total','Pago','Aberto','Atrasado'])document.getElementById('dashDesp'+id).textContent='—';destroyChart('despGrupos');destroyChart('despStatus');for(const id of ['chartDespGruposDados','chartDespStatusDados']){const el=document.getElementById(id);if(el)el.innerHTML=''}document.getElementById('dashDespGruposValores').textContent='';document.getElementById('dashDespStatusValores').textContent='';document.getElementById('dashDespAviso').textContent='Não foi possível carregar as despesas: '+e.message}
}
document.getElementById('dashDespMes').addEventListener('change',carregarDespesasDashboard);
