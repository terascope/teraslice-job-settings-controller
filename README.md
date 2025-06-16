# Teraslice Job Setting Controller

The Teraslice Job Setting Controller(TJSC) is designed to continuously modify the `percent` field of an Elasticsearch record. This record is used within a [Teraslice](https://github.com/terascope/teraslice) job by the [sample_exact_es_percent](https://github.com/terascope/standard-assets/blob/master/docs/asset/operations/sample_exact_es_percent.md) operation to configure the percentage of records to keep. The TJSC monitors the size of an Elasticsearch index in the downstream pipeline of this operation. Every `window_ms` it compares its rate of growth with a `target_rate` of growth. It then feeds the error in the rate of growth to a PID Controller, which calculates an adjustment to the percentage of records to keep.

## Configuration

| Configuration | Description | Type |  Notes |
| ------------- | ----------- | ---- | ------ |
| 'target_rate' | 'The target rate of index growth in MB/sec' | number | required |
| 'window_ms' | 'The time in milliseconds between recalculating the percent of records to keep' | number | default: 300_000 |
| 'initial_percent_kept' | 'Value of the percent field at controller creation. Must be between 0 and 100.' | number | required |
| pid_constants | Object containing the proportional, integral, and derivative constants for the [PID controller](https://en.wikipedia.org/wiki/Proportional%E2%80%93integral%E2%80%93derivative_controller). These constants may require 'tuning' to avoid instability. | Object | See below |
| pid_constants.proportional | 'Proportional gain - determines the reaction to the current error.' | number | default: 0.1 |
| pid_constants.integral | 'Integral gain - corrects accumulated past errors to remove steady-state error - the persistent difference between the desired and actual value.' | number | default: 0.01 |
| pid_constants.derivative | 'Derivative gain - reduces oscillations by predicting future error.' | number | default: 0.1 |
| 'cluster' | | | |
| connections.store.connector | 'name of the terafoundation connector where the percent will be stored' | String | required |
| connections.store.index | 'name of the index where the percent will be stored' | String | required |
| connections.store.document_id | 'name of the document ID where the percent will be stored' | String | required |
| connections.sample.connector | 'name of the terafoundation connector where index to sample is located' | String | required |
| connections.sample.daily_index_prefix | 'prefix of the daily index to sample. This will match the index field of the elasticsearch_sender_api config in the teraslice job writing to the index.' | String | required |
| connections.sample.date_delimiter |  'delimiter between date fields for the daily index. This will match the date_delimiter field of the date_router config in the teraslice job writing to the index.' | String | defaults to '.' |

## How to calculate target_rate

Let's say you want a daily index of 100GB. To convert GB/day to MB/sec you would need to do the following:  
  
100GB/day x (1024MB/1GB) x (1day/24hr) x (1hr/60min) x (1min/60sec)  
= 100 x (1024/86400)  
= 100 x 0.01185185 = 1.185MB/sec

So multiply daily index size in GB by 0.01185185 to get the MB/sec
