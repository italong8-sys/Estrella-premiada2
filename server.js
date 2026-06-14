// =========================================================================
// ROTA DE SAQUE PIX COM VERIFICAÇÃO DE LIQUIDAÇÃO EM TEMPO REAL (SPI POLLING)
// =========================================================================
app.post('/api/saque-pix', async (req, res) => {
    try {
        const { chavePix, pontos } = req.body;

        if (!chavePix || !pontos) {
            return res.status(400).json({ success: false, error: "Chave Pix ou pontuação ausentes no payload." });
        }

        const pontosMinimos = 500;
        if (Number(pontos) < pontosMinimos) {
            return res.status(400).json({ success: false, error: "O saque mínimo exigido é de 500 pontos (R$ 0,50)." });
        }

        const valorReal = parseFloat((Number(pontos) * 0.001).toFixed(2));
        let tipoChave = "EVP"; 
        let chaveDestino = chavePix.trim();

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

        console.log(`[PAYOUT INITIATED] Solicitando R$ ${valorReal} no Asaas...`);

        // 1. Cria a intenção de transferência no Asaas
        const responsePre = await axios.post(ASAAS_URL, {
            value: valorReal,
            pixAddressKey: chaveDestino,
            pixAddressKeyType: tipoChave
        }, {
            headers: {
                'access_token': ASAAS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const transferId = responsePre.data.id;
        console.log(`[PAYOUT PENDING] Transferência registrada com ID: ${transferId}. Aguardando análise do SPI...`);

        // =========================================================================
        // ENGINE DE INTERCEPTAÇÃO ASSÍNCRONA (Aguardar 2.5 segundos para o clearing bancário)
        // =========================================================================
        await new Promise(resolve => setTimeout(resolve, 2500));

        // 2. Consulta o nó do Asaas para capturar o veredito real do Banco Central
        const responseCheck = await axios.get(`${ASAAS_URL}/${transferId}`, {
            headers: {
                'access_token': ASAAS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const statusReal = responseCheck.data.status;
        const motivoFalha = responseCheck.data.failReason || "Autorização externa recusada pelo banco receptor.";

        console.log(`[SPI TELEMETRY] Status atualizado no banco: ${statusReal}`);

        // Se o banco externo recusar dentro dos 2.5s, força o disparo do Catch e salva os pontos
        if (statusReal === "FAILED" || statusReal === "REFUSED") {
            return res.status(400).json({
                success: false,
                error: `Recusa Externa: ${motivoFalha}`
            });
        }

        // Se passar ou continuar pendente em análise de lote, assume liquidação segura
        return res.status(200).json({ 
            success: true, 
            statusPix: statusReal,
            message: "Pix processado pelo barramento com sucesso!" 
        });

    } catch (error) {
        console.error("[CRITICAL CAPTURE] Falha na esteira de liquidação.");
        
        if (error.response && error.response.data) {
            const asaasErrors = error.response.data.errors;
            if (asaasErrors && asaasErrors.length > 0) {
                return res.status(error.response.status).json({
                    success: false,
                    error: `Erro no Asaas: ${asaasErrors[0].description}`
                });
            }
        }
        
        // Repassa o erro de recusa externa customizado para o Front-end interceptar
        return res.status(400).json({
            success: false,
            error: error.message.includes("Recusa Externa") ? error.message : "Transação recusada pela instituição financeira parceira."
        });
    }
});
