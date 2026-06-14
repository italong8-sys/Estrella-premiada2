// =========================================================================
// ROTA DE SAQUE PIX COM TELEMETRIA DE ERROS AVANÇADA (SISTEMA BLINDADO)
// =========================================================================
app.post('/api/saque-pix', async (req, res) => {
    try {
        const { chavePix, pontos } = req.body;

        if (!chavePix || !pontos) {
            return res.status(400).json({ success: false, error: "Chave Pix ou pontuação ausentes no payload." });
        }

        const pontosMinimos = 1000;
        if (Number(pontos) < pontosMinimos) {
            return res.status(400).json({ success: false, error: "O saque mínimo exigido é de 1.000 pontos (R$ 1,00)." });
        }

        // Conversão exata: 1000 pontos = 1.00 Real
        const valorReal = parseFloat((Number(pontos) * 0.001).toFixed(2));

        let tipoChave = "EVP"; 
        let chaveDestino = chavePix.trim();

        // Regex de Tratamento e Higienização de Strings de Entrada
        if (chaveDestino.includes("@")) {
            tipoChave = "EMAIL";
        } else if (/^\d{11}$/.test(chaveDestino.replace(/\D/g, ""))) {
            tipoChave = "CPF";
            chaveDestino = chaveDestino.replace(/\D/g, ""); 
        } else if (/^\d{14}$/.test(chaveDestino.replace(/\D/g, ""))) {
            tipoChave = "CNPJ";
            chaveDestino = chaveDestino.replace(/\D/g, ""); 
        } else if (/^\+?\d{10,13}$/.test(chaveDestino.replace(/\D/g, ""))) {
            tipoChave = "PHONE";
            chaveDestino = chaveDestino.replace(/\D/g, ""); 
        }

        console.log(`[PAYOUT INITIATED] Processando envio de R$ ${valorReal} para chave tipo [${tipoChave}]`);

        const response = await axios.post(ASAAS_URL, {
            value: valorReal,
            pixAddressKey: chaveDestino,
            pixAddressKeyType: tipoChave
        }, {
            headers: {
                'access_token': ASAAS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 200 || response.status === 201) {
            return res.status(200).json({ 
                success: true, 
                message: "Pix enviado e liquidado com sucesso via Asaas!" 
            });
        } else {
            return res.status(500).json({ 
                success: false, 
                error: "O gateway recusou o processamento do lote Pix." 
            });
        }

    } catch (error) {
        // =========================================================================
        // INTERCEPTADOR DE COMPLIANCE E EXCEÇÕES DE BANCO (TELEMETRIA CRÍTICA)
        // =========================================================================
        console.error("[CRITICAL CAPTURE] Falha na execução do pipeline do Asaas.");
        
        if (error.response && error.response.data) {
            const asaasErrors = error.response.data.errors;
            
            if (asaasErrors && asaasErrors.length > 0) {
                const erroPrincipal = asaasErrors[0];
                console.error(`-> Código do Erro no Asaas: ${erroPrincipal.code}`);
                console.error(`-> Descrição Real do Banco: ${erroPrincipal.description}`);
                
                // Retorna o erro real mastigado para o seu Front-end ler no alert()
                return res.status(error.response.status).json({
                    success: false,
                    error: `Erro no Asaas (${erroPrincipal.code}): ${erroPrincipal.description}`
                });
            }
            
            return res.status(error.response.status).json({ success: false, error: JSON.stringify(error.response.data) });
        }

        return res.status(500).json({ 
            success: false, 
            error: `Falha de conexão com a API: ${error.message}` 
        });
    }
});
