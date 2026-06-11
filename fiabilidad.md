# Fiabilidad — Guía rápida para la sustentación (Equipo 2B)

> Resumen ejecutivo de los patrones de fiabilidad aplicados a UN Wheels.
> Pensado para responder, en menos de un minuto por patrón, **qué es** y **qué problema resuelve**.

---

## ¿Qué es Fiabilidad?

**Fiabilidad (reliability)** es la capacidad del sistema de **seguir prestando el servicio correctamente aun cuando algo falla** (un proceso muere, un nodo cae, una réplica se cuelga, la red se pierde).

No se trata de evitar fallos —los fallos van a ocurrir— sino de:

1. **Detectarlos rápido** (health checks, heartbeats).
2. **Aislarlos** para que no contaminen al resto del sistema.
3. **Recuperarse automáticamente** sin intervención humana ni downtime perceptible.

Métricas típicas: **MTTR** (tiempo medio de recuperación), **MTBF** (tiempo medio entre fallos), **% de errores visibles al usuario**, **RTO/RPO**.

---

## Problemas que enfrenta UN Wheels

| # | Problema sin patrones | Consecuencia |
|---|-----------------------|--------------|
| 1 | Una sola instancia de cada microservicio | Si se cae, **todo el servicio asociado deja de funcionar** (login imposible, reservas imposibles…) |
| 2 | El API Gateway no sabe qué réplica está sana | Envía tráfico a una instancia muerta → **errores 5xx visibles al usuario** |
| 3 | Si un nodo físico cae, no hay dónde correr la app | **Downtime total** hasta restaurar el servidor |
| 4 | Nadie vigila el estado de los servicios | El operador se entera del fallo **cuando los usuarios reclaman** |

Cada uno de estos problemas se ataca con un patrón distinto.

---

## Los 4 patrones aplicados

### 1. Service Replication / Hot Spare — *redundancia activa*

- **Qué es:** desplegar **varias réplicas idénticas** del servicio crítico (`loggueo_1`, `loggueo_2`, `loggueo_3`) ejecutándose simultáneamente sobre la misma base de datos.
- **Problema que resuelve:** elimina el **punto único de fallo** del servicio de autenticación. Si una réplica muere, las otras dos siguen atendiendo logins.
- **Cómo se ve en el sistema:** tres contenedores activos del servicio de login en `docker-compose.yml`.

### 2. Service Discovery — *enrutamiento dinámico al pool sano*

- **Qué es:** un **balanceador de carga (HAProxy)** que mantiene la lista de réplicas vivas y enruta cada petición a una de ellas. Si una réplica falla el `httpchk` (`GET /readyz` cada 5 s), HAProxy la **saca del pool**; cuando vuelve a pasar 2 chequeos seguidos, la **reincorpora**.
- **Problema que resuelve:** el API Gateway **no necesita saber qué réplica está sana** ni cambiar su configuración. El nombre lógico `loggueo-service:8000` siempre apunta a una instancia viva.
- **Cómo se ve en el sistema:** servicio `loggueo-service` (HAProxy) en compose, con `option httpchk` y `fall 3 / rise 2`. Verificado por `reliability-tests/test_service_discovery.ps1`.

### 3. Cluster — *redundancia distribuida en varios nodos*

- **Qué es:** desplegar dos réplicas del servicio crítico `routes-reservations-service` en **nodos físicos distintos** mediante Docker Swarm, con `max_replicas_per_node: 1`. Swarm hace failover de red automáticamente.
- **Problema que resuelve:** sobrevivir a fallos de **infraestructura física** (un nodo se apaga, se queda sin memoria, pierde la red). Si el nodo Worker cae, el Manager sigue atendiendo el 100 % del tráfico.
- **Cómo se ve en el sistema:** stack desplegado sobre Docker Swarm con `placement.constraints` y la malla de enrutamiento (`Ingress Routing Mesh`).

### 4. Heartbeat — *monitoreo activo de salud*

- **Qué es:** un componente (`healthmon`) que **hace polling cada 15 s** al endpoint `/health` de cada microservicio sin balanceador propio (chat, routes, notifications, search, loggueo-lb). Tras 3 fallos consecutivos registra el servicio como `UNHEALTHY` y expone el estado en `GET /status`.
- **Problema que resuelve:** **detectar y registrar** caídas de servicios que **no tienen un balanceador encima** (porque no están replicados o son singletons). Da visibilidad operativa sin afectar el tráfico.
- **Cómo se ve en el sistema:** contenedor `health-monitor` en `FrontEnd/healthmon/monitor.js`, escuchando en el puerto interno 9090.

---

## Relación patrón ↔ problema (cheat-sheet)

| Pregunta del jurado | Patrón a citar |
|---------------------|----------------|
| “¿Y si se cae una réplica de auth?” | **Service Replication + Hot Spare** |
| “¿Cómo sabe el gateway a qué réplica mandar?” | **Service Discovery (HAProxy + httpchk)** |
| “¿Y si se cae el servidor completo?” | **Cluster (Docker Swarm + 2 nodos)** |
| “¿Cómo te enteras de que algo falló?” | **Heartbeat (`healthmon`)** |

---

## Cómo se complementan los patrones (no se duplican)

```
                       ┌───────────────────────────────────────────┐
                       │ Service Discovery (HAProxy)               │
                       │  • Decide a quién mandar tráfico          │
                       │  • Excluye réplicas caídas                │
                       └──────────────────┬────────────────────────┘
                                          │ controla
                                          ▼
                       ┌───────────────────────────────────────────┐
                       │ Service Replication / Hot Spare           │
                       │  • Múltiples réplicas activas             │
                       │  • Stateless → cualquiera atiende         │
                       └───────────────────────────────────────────┘

                       ┌───────────────────────────────────────────┐
                       │ Cluster (Swarm, multi-nodo)               │
                       │  • Sobrevive a caída de host físico       │
                       └───────────────────────────────────────────┘

                       ┌───────────────────────────────────────────┐
                       │ Heartbeat (healthmon)                     │
                       │  • OBSERVA, no actúa sobre el tráfico     │
                       │  • Cubre servicios sin balanceador propio │
                       └───────────────────────────────────────────┘
```

**Punto clave para la sustentación:** *Service Discovery* y *Heartbeat* parecen lo mismo pero **no lo son**:

- **Service Discovery** es la **fuente de verdad del enrutamiento** — *qué réplica recibe la próxima petición*.
- **Heartbeat** es **observabilidad** — *qué servicios están vivos para que el operador lo sepa*.

---

## Demostración en vivo (1 minuto)

```powershell
# 1. Estado normal
docker ps --filter "name=loggueo"

# 2. Tirar una réplica
docker stop loggueo_1

# 3. Ver cómo HAProxy la excluye y el login sigue funcionando
cd FrontEnd/reliability-tests
./test_service_discovery.ps1
```

Resultado esperado: `0 errores 5xx` con 1 de 3 réplicas caídas, y reincorporación automática tras `docker start loggueo_1`.
