## START
```
docker compose up --build -d
```
## Service:port
### Webapp:3000
### API Gateway:4000
### Fleet:4001
### Load:4002
### Tracking:4003
### KafkaHost:29092
### KafkaInternal:9092
### Postgres:5432
## STOP
```
docker compose down
```
## FULL RESET (Wipe DB)
```
docker compose down -v
```

