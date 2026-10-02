const moeda=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dataBR=d=>d?new Date(d+'T12:00:00').toLocaleDateString('pt-BR'):'-';
let clientes=[];
let charts={};

function statusClass(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_')}
function msg(texto,tipo='ok'){const el=document.getElementById('mensagem');el.textContent=texto;el.className='mensagem '+tipo;setTimeout(()=>el.className='mensagem',3500)}
async function api(url,op={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...op});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.erro||'Erro no servidor');return d}
function mesLabel(ym){if(!ym)return '';const [a,m]=ym.split('-').map(Number);return new Intl.DateTimeFormat('pt-BR',{month:'short',year:'2-digit'}).format(new Date(a,m-1,1)).replace('.','')}
function destroyChart(nome){if(charts[nome]){charts[nome].destroy();delete charts[nome]}}
function chartBase(){return {responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{usePointStyle:true,boxWidth:8,font:{size:12}}},tooltip:{callbacks:{label:c=>`${c.dataset.label||c.label}: ${moeda(c.raw)}`}}}}}

async function carregarClientes(){const q=document.getElementById('buscaCliente').value.trim();clientes=await api('/api/clientes'+(q?'?q='+encodeURIComponent(q):''));renderClientes();preencherClientes()}
async function carregarPagamentos(){const pags=await api('/api/pagamentos');const body=document.getElementById('pagamentosBody');body.innerHTML=pags.length?pags.map((p,i)=>`<tr><td>${i+1}</td><td>${p.cliente_nome}</td><td>${dataBR(p.data)}</td><td>${moeda(p.valor)}</td><td>${p.observacao||'-'}</td><td><button class="danger" onclick="excluirPagamento(${p.id})">Excluir</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty">Nenhum pagamento registrado.</td></tr>'}

function renderGraficos(d){
  destroyChart('carteira');
  charts.carteira=new Chart(document.getElementById('chartCarteira'),{
    type:'doughnut',
    data:{labels:['Recebido','Falta receber'],datasets:[{data:[d.total_recebido,d.saldo_devedor],backgroundColor:['#202024','#ff8f89'],borderWidth:0,hoverOffset:3}]},
    options:{...chartBase(),cutout:'72%',plugins:{...chartBase().plugins,legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,font:{size:10}}}}}
  });

  destroyChart('recebimentos');
  charts.recebimentos=new Chart(document.getElementById('chartRecebimentos'),{
    type:'bar',
    data:{labels:d.recebimentos_mensais.map(x=>mesLabel(x.mes)),datasets:[{label:'Recebido',data:d.recebimentos_mensais.map(x=>x.valor),backgroundColor:'#e10600',borderRadius:5,maxBarThickness:32}]},
    options:{...chartBase(),plugins:{...chartBase().plugins,legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:9}}},y:{beginAtZero:true,grid:{color:'#f0f0f3'},ticks:{font:{size:9},callback:v=>'R$ '+Number(v).toLocaleString('pt-BR')}}}}
  });

  destroyChart('previsao');
  charts.previsao=new Chart(document.getElementById('chartPrevisao'),{
    type:'bar',
    data:{labels:d.previsao_mensal.map(x=>mesLabel(x.mes)),datasets:[{label:'Previsão',data:d.previsao_mensal.map(x=>x.valor),backgroundColor:'#2a2a2e',borderRadius:5,maxBarThickness:32}]},
    options:{...chartBase(),plugins:{...chartBase().plugins,legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:9}}},y:{beginAtZero:true,grid:{color:'#f0f0f3'},ticks:{font:{size:9},callback:v=>'R$ '+Number(v).toLocaleString('pt-BR')}}}}
  });

  const o=d.orgaos||{};
  destroyChart('orgaosStatus');
  charts.orgaosStatus=new Chart(document.getElementById('chartOrgaosStatus'),{
    type:'doughnut',
    data:{labels:['Pago','Não pago'],datasets:[{data:[o.total_pago||0,o.total_nao_pago||0],backgroundColor:['#202024','#e10600'],borderWidth:0,hoverOffset:3}]},
    options:{...chartBase(),cutout:'72%',plugins:{...chartBase().plugins,legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,font:{size:10}}}}}
  });

  destroyChart('orgaosAno');
  charts.orgaosAno=new Chart(document.getElementById('chartOrgaosAno'),{
    type:'bar',
    data:{labels:(o.por_ano||[]).map(x=>x.ano),datasets:[
      {label:'Pago',data:(o.por_ano||[]).map(x=>x.pago),backgroundColor:'#2a2a2e',borderRadius:4,maxBarThickness:28},
      {label:'Não pago',data:(o.por_ano||[]).map(x=>x.nao_pago),backgroundColor:'#e10600',borderRadius:4,maxBarThickness:28}
    ]},
    options:{...chartBase(),plugins:{...chartBase().plugins,legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,font:{size:9}}}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:9}}},y:{stacked:true,beginAtZero:true,grid:{color:'#f0f0f3'},ticks:{font:{size:9},callback:v=>'R$ '+Number(v).toLocaleString('pt-BR')}}}}
  });

  destroyChart('orgaosTop');
  charts.orgaosTop=new Chart(document.getElementById('chartOrgaosTop'),{
    type:'bar',
    data:{labels:(o.top_devedores||[]).map(x=>x.nome),datasets:[{label:'Não pago',data:(o.top_devedores||[]).map(x=>x.valor),backgroundColor:'#b73a35',borderRadius:4,maxBarThickness:25}]},
    options:{...chartBase(),indexAxis:'y',plugins:{...chartBase().plugins,legend:{display:false}},scales:{y:{grid:{display:false},ticks:{font:{size:9}}},x:{beginAtZero:true,grid:{color:'#f0f0f3'},ticks:{font:{size:9},callback:v=>'R$ '+Number(v).toLocaleString('pt-BR')}}}}
  });
}

async function carregarDashboard(){
  const d=await api('/api/dashboard');
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
  document.getElementById('orgDashPagoQtd').textContent=`${o.quantidade_pago||0} registros pagos`;
  document.getElementById('orgDashAbertoQtd').textContent=`${o.quantidade_nao_pago||0} registros em aberto`;
  renderGraficos(d);
}

function documentoFormatado(v){
  const d=String(v||'').replace(/\D/g,'');
  if(d.length===11)return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');
  if(d.length===14)return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5');
  return v||'-';
}
function localCliente(c){return [c.cidade,c.uf].filter(Boolean).join('/')||'-'}

function renderClientes(){const body=document.getElementById('clientesBody');body.innerHTML=clientes.length?clientes.map(c=>`<tr><td><strong>${c.nome}</strong><div class="table-sub">${c.tipo_pessoa==='PJ'?'Pessoa Jurídica':'Pessoa Física'}</div></td><td>${documentoFormatado(c.cpf_cnpj)}</td><td>${c.whatsapp||c.telefone||'-'}</td><td>${localCliente(c)}</td><td>${moeda(c.divida)}</td><td>${dataBR(c.previsao)}</td><td>${moeda(c.saldo)}</td><td><span class="badge ${statusClass(c.status)}">${c.status}</span></td><td><div class="acoes"><button class="view" onclick="mostrarCliente(${c.id})">Ver</button><button class="edit" onclick="editarCliente(${c.id})">Editar</button><button class="danger" onclick="excluirCliente(${c.id})">Excluir</button></div></td></tr>`).join(''):'<tr><td colspan="9" class="empty">Nenhum cliente cadastrado.</td></tr>'}
function preencherClientes(){const sel=document.getElementById('pagCliente');const atual=sel.value;sel.innerHTML='<option value="">Selecione...</option>'+clientes.map(c=>`<option value="${c.id}">${c.nome}</option>`).join('');sel.value=atual}
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
function editarCliente(id){const c=clientes.find(x=>x.id===id);if(!c)return;const vals={clienteId:c.id,nomeCliente:c.nome,tipoPessoa:c.tipo_pessoa||'PF',cpfCnpj:documentoFormatado(c.cpf_cnpj)==='-'?'':documentoFormatado(c.cpf_cnpj),rgIe:c.rg_ie||'',dataNascimento:c.data_nascimento||'',telefoneCliente:c.telefone||'',whatsappCliente:c.whatsapp||'',emailCliente:c.email||'',cepCliente:c.cep||'',logradouroCliente:c.logradouro||'',numeroCliente:c.numero||'',complementoCliente:c.complemento||'',bairroCliente:c.bairro||'',cidadeCliente:c.cidade||'',ufCliente:c.uf||'',observacoesCliente:c.observacoes||'',valorDivida:c.divida,previsaoPagamento:c.previsao||''};Object.entries(vals).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.value=v});document.getElementById('tituloCliente').textContent='Editar cliente';document.getElementById('cancelarEdicao').classList.remove('hidden');document.querySelector('#clientes .client-card')?.scrollIntoView({behavior:'smooth',block:'start'})}
function limparEdicao(){document.getElementById('clienteForm').reset();document.getElementById('clienteId').value='';document.getElementById('tipoPessoa').value='PF';document.getElementById('tituloCliente').textContent='Cadastrar cliente';document.getElementById('cancelarEdicao').classList.add('hidden')}
document.getElementById('cancelarEdicao').onclick=limparEdicao;
async function excluirCliente(id){if(!confirm('Excluir este cliente e todos os pagamentos vinculados?'))return;try{await api('/api/clientes/'+id,{method:'DELETE'});msg('Cliente excluído.');await atualizarTudo()}catch(err){msg(err.message,'erro')}}

function detalheLinha(rotulo,valor){return `<div class="detail-item"><span>${rotulo}</span><strong>${valor||'-'}</strong></div>`}
function mostrarCliente(id){const c=clientes.find(x=>x.id===id);if(!c)return;document.getElementById('clienteModalNome').textContent=c.nome;const endereco=[c.logradouro,c.numero,c.complemento,c.bairro,c.cidade,c.uf,c.cep].filter(Boolean).join(', ');document.getElementById('clienteModalBody').innerHTML=`
  <div class="detail-section"><h4>Identificação</h4><div class="detail-grid">${detalheLinha('Tipo',c.tipo_pessoa==='PJ'?'Pessoa Jurídica':'Pessoa Física')}${detalheLinha('CPF/CNPJ',documentoFormatado(c.cpf_cnpj))}${detalheLinha('RG/IE',c.rg_ie)}${detalheLinha('Nascimento/Fundação',dataBR(c.data_nascimento))}</div></div>
  <div class="detail-section"><h4>Contato</h4><div class="detail-grid">${detalheLinha('Telefone',c.telefone)}${detalheLinha('WhatsApp',c.whatsapp)}${detalheLinha('E-mail',c.email)}</div></div>
  <div class="detail-section"><h4>Endereço</h4><div class="detail-grid">${detalheLinha('Endereço completo',endereco)}</div></div>
  <div class="detail-section"><h4>Financeiro</h4><div class="detail-grid">${detalheLinha('Dívida inicial',moeda(c.divida))}${detalheLinha('Total pago',moeda(c.total_pago))}${detalheLinha('Saldo',moeda(c.saldo))}${detalheLinha('Previsão',dataBR(c.previsao))}${detalheLinha('Último pagamento',dataBR(c.ultimo_pagamento))}${detalheLinha('Status',c.status)}</div></div>
  ${c.observacoes?`<div class="detail-section"><h4>Observações</h4><p class="detail-notes">${c.observacoes}</p></div>`:''}`;document.getElementById('clienteModal').classList.remove('hidden');document.getElementById('clienteModalOverlay').classList.remove('hidden')}
function fecharClienteModal(){document.getElementById('clienteModal').classList.add('hidden');document.getElementById('clienteModalOverlay').classList.add('hidden')}
document.getElementById('fecharClienteModal')?.addEventListener('click',fecharClienteModal);document.getElementById('clienteModalOverlay')?.addEventListener('click',fecharClienteModal);
function mascaraDocumento(e){let v=e.target.value.replace(/\D/g,'').slice(0,14);if(v.length<=11){v=v.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2')}else{v=v.replace(/^(\d{2})(\d)/,'$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/,'$1.$2.$3').replace(/\.(\d{3})(\d)/,'.$1/$2').replace(/(\d{4})(\d)/,'$1-$2')}e.target.value=v}
function mascaraCep(e){let v=e.target.value.replace(/\D/g,'').slice(0,8);if(v.length>5)v=v.slice(0,5)+'-'+v.slice(5);e.target.value=v}
document.getElementById('cpfCnpj')?.addEventListener('input',mascaraDocumento);document.getElementById('cepCliente')?.addEventListener('input',mascaraCep);document.getElementById('ufCliente')?.addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,2));

document.getElementById('pagamentoForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/pagamentos',{method:'POST',body:JSON.stringify({cliente_id:Number(document.getElementById('pagCliente').value),data:document.getElementById('pagData').value,valor:Number(document.getElementById('pagValor').value),observacao:document.getElementById('pagObs').value.trim()})});msg('Pagamento registrado.');e.target.reset();document.getElementById('pagData').valueAsDate=new Date();await atualizarTudo()}catch(err){msg(err.message,'erro')}})
async function excluirPagamento(id){if(!confirm('Excluir este pagamento?'))return;try{await api('/api/pagamentos/'+id,{method:'DELETE'});msg('Pagamento excluído.');await atualizarTudo()}catch(err){msg(err.message,'erro')}}

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
async function carregarOrgaosPublicos(){
  const params=new URLSearchParams();
  const q=document.getElementById('buscaOrgao')?.value.trim();
  const ano=document.getElementById('filtroAnoOrgao')?.value.trim();
  const status=document.getElementById('filtroStatusOrgao')?.value;
  if(q)params.set('q',q);if(ano)params.set('ano',ano);if(status)params.set('status',status);
  const d=await api('/api/orgaos-publicos'+(params.toString()?'?'+params.toString():''));
  orgaosPublicos=d.registros||[];
  const r=d.resumo||{};
  if(document.getElementById('govQtd')) document.getElementById('govQtd').textContent=r.quantidade||0;
  if(document.getElementById('govTotal')) document.getElementById('govTotal').textContent=moeda(r.total||0);
  if(document.getElementById('govPago')) document.getElementById('govPago').textContent=moeda(r.total_pago||0);
  if(document.getElementById('govNaoPago')) document.getElementById('govNaoPago').textContent=moeda(r.total_nao_pago||0);
  renderOrgaosPublicos();
}
function renderOrgaosPublicos(){
  const body=document.getElementById('orgaosBody');if(!body)return;
  body.innerHTML=orgaosPublicos.length?orgaosPublicos.map(r=>`<tr>
    <td><strong>${r.nome_orgao}</strong></td><td>${r.tipo_orgao}</td><td>${r.dia}</td><td>${String(r.mes).padStart(2,'0')}</td><td>${r.ano}</td>
    <td>${moeda(r.valor_debito)}</td><td><span class="badge ${r.pago?'QUITADO':'ATRASADO'}">${r.pago?'PAGO':'NÃO PAGO'}</span></td><td>${r.numero_nota_fiscal}</td>
    <td><div class="acoes"><button class="edit" onclick="editarOrgaoPublico(${r.id})">Editar</button><button class="danger" onclick="excluirOrgaoPublico(${r.id})">Excluir</button></div></td>
  </tr>`).join(''):'<tr><td colspan="9" class="empty">Nenhum débito de órgão público cadastrado.</td></tr>';
}
function limparOrgaoPublico(){
  const f=document.getElementById('orgaoForm');if(!f)return;f.reset();document.getElementById('orgaoId').value='';document.getElementById('orgaoPago').value='false';document.getElementById('tituloOrgao').textContent='Cadastrar débito de órgão público';document.getElementById('cancelarOrgao').classList.add('hidden');
}
function editarOrgaoPublico(id){
  const r=orgaosPublicos.find(x=>x.id===id);if(!r)return;
  document.getElementById('orgaoId').value=r.id;document.getElementById('orgaoNome').value=r.nome_orgao;document.getElementById('orgaoTipo').value=r.tipo_orgao;document.getElementById('orgaoData').value=r.data_debito;document.getElementById('orgaoValor').value=r.valor_debito;document.getElementById('orgaoNota').value=r.numero_nota_fiscal;document.getElementById('orgaoOrdem').value=r.numero_ordem||'';document.getElementById('orgaoPago').value=String(r.pago);document.getElementById('tituloOrgao').textContent='Editar débito de órgão público';document.getElementById('cancelarOrgao').classList.remove('hidden');document.querySelector('#orgaos .card')?.scrollIntoView({behavior:'smooth',block:'start'});
}
async function excluirOrgaoPublico(id){
  if(!confirm('Excluir este débito de órgão público?'))return;
  try{await api('/api/orgaos-publicos/'+id,{method:'DELETE'});msg('Débito excluído.');await carregarOrgaosPublicos()}catch(err){msg(err.message,'erro')}
}
const orgaoForm=document.getElementById('orgaoForm');
if(orgaoForm){
  orgaoForm.addEventListener('submit',async e=>{e.preventDefault();const id=document.getElementById('orgaoId').value;const payload={nome_orgao:document.getElementById('orgaoNome').value.trim(),tipo_orgao:document.getElementById('orgaoTipo').value,data_debito:document.getElementById('orgaoData').value,valor_debito:Number(document.getElementById('orgaoValor').value),numero_nota_fiscal:document.getElementById('orgaoNota').value.trim(),numero_ordem:document.getElementById('orgaoOrdem').value.trim(),pago:document.getElementById('orgaoPago').value==='true'};try{await api(id?'/api/orgaos-publicos/'+id:'/api/orgaos-publicos',{method:id?'PUT':'POST',body:JSON.stringify(payload)});msg(id?'Débito atualizado.':'Débito cadastrado.');limparOrgaoPublico();await carregarOrgaosPublicos()}catch(err){msg(err.message,'erro')}});
  document.getElementById('cancelarOrgao').addEventListener('click',limparOrgaoPublico);
  ['buscaOrgao','filtroAnoOrgao','filtroStatusOrgao'].forEach(id=>document.getElementById(id)?.addEventListener(id==='buscaOrgao'?'input':'change',()=>{clearTimeout(window._org);window._org=setTimeout(()=>carregarOrgaosPublicos().catch(err=>msg(err.message,'erro')),220)}));
  carregarOrgaosPublicos().catch(err=>msg(err.message,'erro'));
}
