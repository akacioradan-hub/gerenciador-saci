"""Contas a pagar e cadastros vinculados; usa o banco central da aplicação."""
import csv
import io
from datetime import date
from decimal import Decimal, InvalidOperation
from flask import request, jsonify, send_file
from sqlalchemy import or_, func, inspect, text
from sqlalchemy.exc import IntegrityError


def registrar_despesas(app, db, login_required):
    class Funcionario(db.Model):
        __tablename__ = 'funcionarios_despesas'
        id = db.Column(db.Integer, primary_key=True)
        nome = db.Column(db.String(180), nullable=False)
        cargo = db.Column(db.String(100))
        telefone = db.Column(db.String(30))
        observacoes = db.Column(db.Text)

    class Veiculo(db.Model):
        __tablename__ = 'veiculos_despesas'
        id = db.Column(db.Integer, primary_key=True)
        nome = db.Column(db.String(180), nullable=False)
        placa = db.Column(db.String(10), nullable=False, unique=True)
        ano = db.Column(db.Integer)
        observacoes = db.Column(db.Text)

    class Fornecedor(db.Model):
        __tablename__ = 'fornecedores_despesas'
        id = db.Column(db.Integer, primary_key=True)
        nome = db.Column(db.String(180), nullable=False)
        documento = db.Column(db.String(30))
        telefone = db.Column(db.String(30))
        observacoes = db.Column(db.Text)

    class Terceirizado(db.Model):
        __tablename__ = 'terceirizados_despesas'
        id = db.Column(db.Integer, primary_key=True)
        nome = db.Column(db.String(180), nullable=False)
        servico = db.Column(db.String(100))
        documento = db.Column(db.String(30))
        telefone = db.Column(db.String(30))
        observacoes = db.Column(db.Text)

    class Despesa(db.Model):
        __tablename__ = 'despesas_mensais'
        id = db.Column(db.Integer, primary_key=True)
        descricao = db.Column(db.String(220), nullable=False)
        grupo = db.Column(db.String(30), nullable=False)
        categoria = db.Column(db.String(100), nullable=False)
        competencia = db.Column(db.String(7), nullable=False, index=True)
        vencimento = db.Column(db.Date, nullable=False, index=True)
        valor = db.Column(db.Numeric(14, 2), nullable=False)
        prioridade = db.Column(db.String(20), nullable=False, default='Normal')
        pago = db.Column(db.Boolean, nullable=False, default=False)
        data_pagamento = db.Column(db.Date)
        documento = db.Column(db.String(100))
        observacoes = db.Column(db.Text)
        funcionario_id = db.Column(db.Integer, db.ForeignKey('funcionarios_despesas.id', ondelete='RESTRICT'), index=True)
        veiculo_id = db.Column(db.Integer, db.ForeignKey('veiculos_despesas.id', ondelete='RESTRICT'), index=True)
        fornecedor_id = db.Column(db.Integer, db.ForeignKey('fornecedores_despesas.id', ondelete='RESTRICT'), index=True)
        funcionario = db.relationship(Funcionario)
        veiculo = db.relationship(Veiculo)
        fornecedor = db.relationship(Fornecedor)
        terceirizado_id = db.Column(db.Integer, db.ForeignKey("terceirizados_despesas.id", ondelete="RESTRICT"), index=True)
        terceirizado = db.relationship(Terceirizado)
        criado_em = db.Column(db.DateTime, server_default=func.now(), nullable=False)

    modelos = {'funcionarios': Funcionario, 'veiculos': Veiculo, 'fornecedores': Fornecedor, 'terceirizados': Terceirizado}
    grupos = ('Custos fixos', 'Fornecedores', 'Despesas variáveis')
    prioridades = ('Baixa', 'Normal', 'Alta', 'Urgente')

    def texto(dados, campo, limite=220):
        v = dados.get(campo) or ''
        if not isinstance(v, str) or len(v.strip()) > limite:
            raise ValueError(f'Campo {campo} inválido ou muito longo.')
        return v.strip()

    def mes(valor):
        if not isinstance(valor, str) or len(valor) != 7:
            raise ValueError('Informe o mês de competência.')
        date.fromisoformat(valor + '-01')
        return valor

    def cadastro_dict(r):
        campos = ('nome', 'cargo', 'servico', 'telefone', 'placa', 'ano', 'documento', 'observacoes')
        return {'id': r.id, **{c: getattr(r, c) for c in campos if hasattr(r, c)}}

    def despesa_dict(r):
        return {'id': r.id, 'descricao': r.descricao, 'grupo': r.grupo, 'categoria': r.categoria,
                'competencia': r.competencia, 'vencimento': r.vencimento.isoformat(), 'valor': float(r.valor),
                'prioridade': r.prioridade, 'pago': r.pago,
                'data_pagamento': r.data_pagamento.isoformat() if r.data_pagamento else None,
                'documento': r.documento, 'observacoes': r.observacoes,
                'funcionario_id': r.funcionario_id, 'veiculo_id': r.veiculo_id, 'fornecedor_id': r.fornecedor_id, 'terceirizado_id': r.terceirizado_id,
                'funcionario_nome': r.funcionario.nome if r.funcionario else '',
                'veiculo_nome': f'{r.veiculo.nome} · {r.veiculo.placa}' if r.veiculo else '',
                'fornecedor_nome': r.fornecedor.nome if r.fornecedor else '',
                'terceirizado_nome': r.terceirizado.nome if r.terceirizado else '',
                'status': 'PAGO' if r.pago else ('ATRASADO' if r.vencimento < date.today() else 'EM ABERTO')}

    def validar(d):
        p = {c: texto(d, c, n) for c, n in [('descricao', 220), ('categoria', 100), ('grupo', 30),
             ('prioridade', 20), ('documento', 100), ('observacoes', 5000)]}
        if not p['descricao'] or not p['categoria']:
            raise ValueError('Informe descrição e categoria.')
        if p['grupo'] not in grupos or p['prioridade'] not in prioridades:
            raise ValueError('Grupo ou prioridade inválidos.')
        p['competencia'] = mes(d.get('competencia'))
        p['vencimento'] = date.fromisoformat(d.get('vencimento') or '')
        valor = Decimal(str(d.get('valor')))
        if not valor.is_finite() or valor <= 0 or valor >= Decimal('1000000000000') or valor != valor.quantize(Decimal('.01')):
            raise ValueError('Informe um valor positivo com até duas casas decimais.')
        p['valor'] = valor
        if not isinstance(d.get('pago', False), bool):
            raise ValueError('Situação de pagamento inválida.')
        p['pago'] = d.get('pago', False)
        p['data_pagamento'] = date.fromisoformat(d.get('data_pagamento') or '') if p['pago'] else None
        for tipo, campo in [('funcionarios', 'funcionario_id'), ('veiculos', 'veiculo_id'), ('fornecedores', 'fornecedor_id'), ('terceirizados', 'terceirizado_id')]:
            ident = d.get(campo)
            p[campo] = int(ident) if ident else None
            if p[campo] and not db.session.get(modelos[tipo], p[campo]):
                raise ValueError('Cadastro vinculado não encontrado.')
        if p['grupo'] == 'Fornecedores' and not p['fornecedor_id']:
            raise ValueError('Selecione o fornecedor.')
        return p

    def consultar():
        competencia = mes(request.args.get('mes') or date.today().strftime('%Y-%m'))
        stmt = db.select(Despesa).where(Despesa.competencia == competencia)
        for campo in ('grupo', 'prioridade', 'funcionario_id', 'veiculo_id', 'fornecedor_id', 'terceirizado_id'):
            valor = request.args.get(campo)
            if valor:
                if campo.endswith('_id'):
                    valor = int(valor)
                stmt = stmt.where(getattr(Despesa, campo) == valor)
        status = request.args.get('status')
        if status == 'pago': stmt = stmt.where(Despesa.pago.is_(True))
        elif status == 'aberto': stmt = stmt.where(Despesa.pago.is_(False))
        elif status == 'atrasado': stmt = stmt.where(Despesa.pago.is_(False), Despesa.vencimento < date.today())
        busca = request.args.get('q', '').strip()
        if busca:
            stmt = stmt.where(or_(Despesa.descricao.ilike(f'%{busca}%'), Despesa.categoria.ilike(f'%{busca}%'), Despesa.documento.ilike(f'%{busca}%')))
        return db.session.execute(stmt.order_by(Despesa.vencimento, Despesa.id)).scalars().all()

    @app.get('/api/despesas/cadastros')
    @login_required
    def cadastros_despesas():
        return jsonify({tipo: [cadastro_dict(r) for r in db.session.execute(db.select(modelo).order_by(modelo.nome)).scalars()]
                        for tipo, modelo in modelos.items()})

    @app.route('/api/despesas/cadastros/<tipo>', methods=['POST'])
    @app.route('/api/despesas/cadastros/<tipo>/<int:ident>', methods=['PUT', 'DELETE'])
    @login_required
    def salvar_cadastro_despesa(tipo, ident=None):
        modelo = modelos.get(tipo)
        if not modelo: return jsonify(erro='Tipo de cadastro inválido.'), 404
        r = db.session.get(modelo, ident) if ident else modelo()
        if r is None: return jsonify(erro='Cadastro não encontrado.'), 404
        if request.method == 'DELETE':
            campo = {'funcionarios': Despesa.funcionario_id, 'veiculos': Despesa.veiculo_id, 'fornecedores': Despesa.fornecedor_id, 'terceirizados': Despesa.terceirizado_id}[tipo]
            if db.session.execute(db.select(Despesa.id).where(campo == ident).limit(1)).first():
                return jsonify(erro='Este cadastro possui despesas vinculadas. Mantenha-o para preservar o histórico.'), 409
            db.session.delete(r); db.session.commit()
            return jsonify(ok=True)
        try:
            d = request.get_json(silent=True) or {}
            nome = texto(d, 'nome', 180)
            if not nome: raise ValueError('Informe o nome.')
            r.nome = nome; r.observacoes = texto(d, 'observacoes', 5000)
            if tipo == 'veiculos':
                r.placa = texto(d, 'placa', 10).upper().replace('-', '').replace(' ', '')
                if not r.placa or not r.placa.isalnum(): raise ValueError('Informe uma placa válida.')
                r.ano = int(d['ano']) if d.get('ano') else None
                if r.ano and not 1900 <= r.ano <= 2100: raise ValueError('Ano inválido.')
            else:
                r.telefone = texto(d, 'telefone', 30)
                if tipo == 'funcionarios': r.cargo = texto(d, 'cargo', 100)
                else: r.documento = texto(d, 'documento', 30)
                if tipo == 'terceirizados': r.servico = texto(d, 'servico', 100)
            db.session.add(r); db.session.commit()
            return jsonify(cadastro_dict(r)), 200 if ident else 201
        except (ValueError, TypeError):
            db.session.rollback(); return jsonify(erro='Confira os dados: nome obrigatório, limites dos campos e ano/placa válidos.'), 400
        except IntegrityError:
            db.session.rollback(); return jsonify(erro='Já existe um veículo com esta placa.'), 409

    @app.get('/api/despesas')
    @login_required
    def listar_despesas():
        try: registros = consultar()
        except (ValueError, TypeError): return jsonify(erro='Filtro de mês ou cadastro inválido.'), 400
        total = sum((r.valor for r in registros), Decimal(0))
        pago = sum((r.valor for r in registros if r.pago), Decimal(0))
        atrasado = sum((r.valor for r in registros if not r.pago and r.vencimento < date.today()), Decimal(0))
        por_grupo = {g: float(sum((r.valor for r in registros if r.grupo == g), Decimal(0))) for g in grupos}
        return jsonify(registros=[despesa_dict(r) for r in registros], resumo={
            'total': float(total), 'pago': float(pago), 'aberto': float(total-pago),
            'atrasado': float(atrasado), 'quantidade': len(registros), 'por_grupo': por_grupo})

    @app.route('/api/despesas', methods=['POST'])
    @app.route('/api/despesas/<int:ident>', methods=['PUT', 'DELETE'])
    @login_required
    def salvar_despesa(ident=None):
        r = db.session.get(Despesa, ident) if ident else Despesa()
        if r is None: return jsonify(erro='Despesa não encontrada.'), 404
        if request.method == 'DELETE':
            db.session.delete(r); db.session.commit(); return jsonify(ok=True)
        try: p = validar(request.get_json(silent=True) or {})
        except (ValueError, TypeError, InvalidOperation, OverflowError) as exc:
            return jsonify(erro=str(exc) if isinstance(exc, ValueError) else 'Confira datas, vínculos e valor da despesa.'), 400
        for c, v in p.items(): setattr(r, c, v)
        db.session.add(r); db.session.commit()
        return jsonify(despesa_dict(r)), 200 if ident else 201

    @app.patch('/api/despesas/<int:ident>/status')
    @login_required
    def status_despesa(ident):
        r = db.session.get(Despesa, ident)
        if r is None: return jsonify(erro='Despesa não encontrada.'), 404
        d = request.get_json(silent=True) or {}
        if not isinstance(d.get('pago'), bool): return jsonify(erro='Informe Pago ou Em aberto.'), 400
        try: data = date.fromisoformat(d.get('data_pagamento') or '') if d['pago'] else None
        except (ValueError, TypeError): return jsonify(erro='Informe a data de pagamento.'), 400
        r.pago = d['pago']; r.data_pagamento = data; db.session.commit()
        return jsonify(despesa_dict(r))

    @app.get('/api/exportar/despesas.csv')
    @login_required
    def exportar_despesas():
        try: registros = consultar()
        except (ValueError, TypeError): return jsonify(erro='Filtro inválido.'), 400
        out = io.StringIO(); writer = csv.writer(out, delimiter=';')
        writer.writerow(['Competência','Descrição','Grupo','Categoria','Fornecedor','Funcionário','Veículo','Terceirizado','Prioridade','Vencimento','Valor','Situação','Pagamento','Documento','Observações'])
        for r in registros:
            d = despesa_dict(r)
            row = [r.competencia,r.descricao,r.grupo,r.categoria,d['fornecedor_nome'],d['funcionario_nome'],d['veiculo_nome'],d['terceirizado_nome'],r.prioridade,r.vencimento.isoformat(),f'{r.valor:.2f}',d['status'],d['data_pagamento'] or '',r.documento or '',r.observacoes or '']
            writer.writerow(["'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v for v in row])
        return send_file(io.BytesIO(out.getvalue().encode('utf-8-sig')), mimetype='text/csv', as_attachment=True, download_name='despesas_mes.csv')

    def backup():
        return {'despesas_mensais': [despesa_dict(r) for r in db.session.execute(db.select(Despesa)).scalars()],
                **{tipo: [cadastro_dict(r) for r in db.session.execute(db.select(modelo)).scalars()] for tipo, modelo in modelos.items()}}
    def migrar():
        # create_all cria a nova tabela; adiciona somente a coluna nas despesas antigas.
        colunas = {c['name'] for c in inspect(db.engine).get_columns('despesas_mensais')}
        if 'terceirizado_id' not in colunas:
            with db.engine.begin() as conn:
                conn.execute(text('ALTER TABLE despesas_mensais ADD COLUMN terceirizado_id INTEGER REFERENCES terceirizados_despesas(id) ON DELETE RESTRICT'))
        with db.engine.begin() as conn:
            conn.execute(text('CREATE INDEX IF NOT EXISTS ix_despesas_mensais_terceirizado_id ON despesas_mensais (terceirizado_id)'))
    return backup, migrar
