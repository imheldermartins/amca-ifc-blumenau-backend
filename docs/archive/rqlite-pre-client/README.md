# Histórico anterior à cadeia declarativa

Estas migrations e metadata foram preservadas sem editar seus bytes quando o
fluxo foi reiniciado, a pedido do usuário, para validar inferência em banco vazio.
São referência histórica, não entrada do runner atual. O teste de upgrade antigo
também foi arquivado; o teste ativo verifica a criação direta das constraints.

A cadeia atual e a configuração estão no código do backend. Não copie estes
arquivos para a pasta ativa de migrations nem aplique a cadeia nova sobre um banco
com este histórico sem planejar uma migração de dados separadamente.
