const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const elems = new Map();
function elem(id) {
  if (!elems.has(id)) {
    const e = {id, value:'', textContent:'', innerHTML:'', required:false, disabled:false, dataset:{}, attrs:{},
      classList:{data:new Set(), add(s){this.data.add(s)}, remove(s){this.data.delete(s)}, toggle(s,force){if(force===undefined){if(this.data.has(s)){this.data.delete(s); return false}this.data.add(s);return true}if(force)this.data.add(s);else this.data.delete(s);return force},contains(s){return this.data.has(s)}},
      focus(){this.focused=true}, scrollIntoView(){},reset(){for(const [k,v] of elems) if(k.startsWith('despCad'))v.value=''},setAttribute(n,v){this.attrs[n]=v},addEventListener() {}}
    elems.set(id,e);
  }
  return elems.get(id);
}
const tipos=['funcionarios','veiculos','fornecedores','terceirizados'];
const bots=tipos.map(t=>Object.assign(elem('botao-'+t),{dataset:{despCatalog:t}}));
const fields=tipos.map(t=>Object.assign(elem('label-'+t),{dataset:{despField:t}}));
const doc={getElementById(id){return id==='despesas'?null:elem(id)},querySelectorAll(sel){if(sel==='[data-desp-catalog]')return bots;if(sel==='[data-desp-field]')return fields;return []}};
const context={document:doc,console, dataBR(x){return x||'—'},escaparFinanceiro(x){return String(x).replaceAll('&','&amp;').replaceAll('"','&quot;')}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','static','despesas.js'),'utf8'),context);
for (const tipo of tipos){
  const nome=tipo==='veiculos'?'Caminhão':'Cadastro Teste';
  context.reg = {id:42,nome, cargo:'Gerente',telefone:'84999999999',placa:'ABC1234',ano:2020,servico:'Reparos',documento:'999',endereco:'Rua B',data_nascimento:'1990-01-01',observacoes:'Descrição'};
  vm.runInContext(`despCadastros['${tipo}']=[reg];trocarCadastroDespesa('${tipo}');editarCadastroDespesa(42)`,context);
  assert.equal(elem('despCadId').value,42);
  assert.equal(elem('despCadNome').value, nome);
  assert.ok(elem('despCadFormTitulo').textContent.includes('Editar'));
  assert.equal(elem('despCadSalvar').textContent,'Salvar alterações');
  assert.ok(elem('despCadBody').innerHTML.includes('✎ Editar'));
  assert.equal(bots.find(b=>b.dataset.despCatalog===tipo).attrs['aria-pressed'],'true');
  vm.runInContext(`trocarCadastroDespesa('${tipo}',true)`,context);
  assert.equal(elem('despCadId').value,'');
  assert.equal(elem('despCadSalvar').textContent,'Salvar cadastro');
  assert.equal(elem('despCadForm').classList.contains('hidden'),false);
}
console.log('OK: 4 categorias; edição preenchida e criação limpa; botões e seleção da categoria.');
